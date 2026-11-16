import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stopPreload } from "../src/lib/compile.ts";
import { startPreload } from "../src/lib/preload.ts";
import compileRouter from "../src/routes/compile.ts";
import healthRouter from "../src/routes/health.ts";
import { useFakeTool } from "./fake-tool.ts";

// The server's own preload, which the host never starts (it has no warm
// cache), is the real one here, running a script that never finishes and says
// which process it is: every request below arrives while it is pending.
const pending = vi.hoisted(() => ({
  dir: "",
  // What compile.ts asked to preload, before this file put a view in.
  views: [] as unknown[],
}));

vi.mock("../src/lib/preload.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/preload.ts")>();
  pending.dir = mkdtempSync(join(tmpdir(), "preload-pending-"));
  const script = join(pending.dir, "run");
  writeFileSync(
    script,
    `#!/bin/sh\necho $$ > ${pending.dir}/pid\nexec sleep 60\n`,
    {
      mode: 0o755,
    },
  );
  const startPreload: typeof actual.startPreload = (view, given) => {
    if (given !== undefined) {
      return actual.startPreload(view, given);
    }
    pending.views.push(view);
    return actual.startPreload(
      { targetDir: "/none", cargoHome: "/none" },
      script,
    );
  };
  return { ...actual, startPreload };
});

vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  CARGO_TARGET_DIR: join(tmpdir(), "preload-target"),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const counterContractDir = path.resolve(
  __dirname,
  "../examples/counter-contract/counter-contract",
);
const view = { targetDir: "/none", cargoHome: "/none" };

// A script for `startPreload` to run, in a directory of its own.
const useScripts = () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "preload-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return {
    path: (name: string) => join(dir, name),
    write: async (name: string, script: string) => {
      await writeFile(join(dir, name), script, { mode: 0o755 });
      return join(dir, name);
    },
  };
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("startPreload", () => {
  const scripts = useScripts();

  it("starts nothing without a warm cache", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const marker = scripts.path("ran");
    const script = await scripts.write("mark", `#!/bin/sh\n: > ${marker}\n`);

    const preload = startPreload(undefined, script);
    await preload.settled;
    preload.stop();

    expect(preload.durationMs()).toBeUndefined();
    await expect(readFile(marker)).rejects.toThrow("ENOENT");
    expect(error).not.toHaveBeenCalled();
  });

  it("runs the script on the view and reports how long it took", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const script = await scripts.write(
      "read",
      `#!/bin/sh\necho "$1 $2" > ${scripts.path("args")}\necho 2097152\n`,
    );

    const preload = startPreload(
      { targetDir: "/cache/target", cargoHome: "/cache/cargo-home" },
      script,
    );
    expect(preload.durationMs()).toBeUndefined();
    await preload.settled;

    expect(preload.durationMs()).toBeGreaterThan(0);
    expect(await readFile(scripts.path("args"), "utf-8")).toBe(
      "/cache/target /cache/cargo-home\n",
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining("(2 MiB)"));
  });

  it("logs a failure once and settles all the same", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const script = await scripts.write(
      "fail",
      "#!/bin/sh\necho 'nothing to read' >&2\nexit 1\n",
    );

    const preload = startPreload(view, script);

    await expect(preload.settled).resolves.toBeUndefined();
    expect(preload.durationMs()).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("settles when the script isn't installed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const preload = startPreload(view, scripts.path("missing"));

    await expect(preload.settled).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("stops at once, with what it started, and logs nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pidFile = scripts.path("pid");
    // The sleep is the script's child: stopping must end it too.
    const script = await scripts.write(
      "hang",
      `#!/bin/sh\nsleep 60 &\necho $! > ${pidFile}\nwait\n`,
    );
    const preload = startPreload(view, script);
    await vi.waitFor(async () => {
      expect(Number(await readFile(pidFile, "utf-8"))).toBeGreaterThan(0);
    });
    const pid = Number(await readFile(pidFile, "utf-8"));
    expect(alive(pid)).toBe(true);

    const start = Date.now();
    preload.stop();
    await preload.settled;

    expect(Date.now() - start).toBeLessThan(5_000);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect(preload.durationMs()).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("a server whose preload is still running", () => {
  // A build that fails at once: enough to show it got the slot and ran.
  useFakeTool(
    "cargo",
    `#!/bin/sh
case "$1 $2" in
  "miden --version") echo "cargo-miden 0.0.0" ;;
  *) echo "error: no toolchain here" >&2; exit 101 ;;
esac
`,
  );
  const app = express()
    .use(express.json({ limit: "1mb" }))
    .use(healthRouter)
    .use(compileRouter)
    .use(errorHandler);

  const pendingPid = async () =>
    Number(await readFile(join(pending.dir, "pid"), "utf-8"));

  afterAll(async () => {
    await stopPreload();
    await rm(pending.dir, { recursive: true, force: true });
  });

  it("started it with the server, for no view on the host", async () => {
    expect(pending.views).toEqual([undefined]);
    await vi.waitFor(async () => {
      expect(alive(await pendingPid())).toBe(true);
    });
  });

  it("answers the health probe", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("timestamp");
    expect(alive(await pendingPid())).toBe(true);
  });

  it("builds at once, ends the preload and reports none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const files = await readProjectFiles(counterContractDir);
    const start = Date.now();

    const res = await request(app).post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body.built).toBe(false);
    expect(res.headers["server-timing"]).toMatch(/^layout;dur=\d+, cargo;/);
    expect(Date.now() - start).toBeLessThan(10_000);
    // The build ended it, not this file.
    const pid = await pendingPid();
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  }, 30_000);
});
