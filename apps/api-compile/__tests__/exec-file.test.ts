import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "../src/lib/utils.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The kill may take a moment to land, so poll instead of checking once.
const waitUntilGone = async (pid: number) => {
  const deadline = performance.now() + 1_000;
  while (isAlive(pid) && performance.now() < deadline) {
    await sleep(50);
  }
  return !isAlive(pid);
};

const readPid = async (pidFile: string) =>
  Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);

describe("execFile", () => {
  let dir: string;
  let spawner: string;
  let okScript: string;
  let failScript: string;
  let counter = 0;
  const pidFiles: string[] = [];

  const script = async (name: string, body: string) => {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  };

  const newPidFile = () => {
    const path = join(dir, `pid-${counter++}`);
    pidFiles.push(path);
    return path;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "exec-file-"));
    // The child outlives the script and inherits its stdout.
    spawner = await script("spawner.sh", 'sleep 30 &\necho $! > "$1"\nwait');
    okScript = await script("ok.sh", "echo out; echo err >&2");
    failScript = await script("fail.sh", "echo boom >&2; exit 3");
  });

  afterAll(async () => {
    // Do not leave a `sleep 30` orphan behind if a test failed.
    for (const pidFile of pidFiles) {
      if (!existsSync(pidFile)) continue;
      try {
        process.kill(await readPid(pidFile), "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("kills what the subprocess started when it times out", async () => {
    const pidFile = newPidFile();
    const start = performance.now();
    await expect(
      execFile(spawner, [pidFile], { timeout: 500 }),
    ).rejects.toThrow(`${spawner} timed out after 0.5s`);
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(await waitUntilGone(await readPid(pidFile))).toBe(true);
  }, 10_000);

  it("kills what the subprocess started when it is cancelled", async () => {
    const pidFile = newPidFile();
    const controller = new AbortController();
    const start = performance.now();
    const promise = execFile(spawner, [pidFile], {
      timeout: 20_000,
      signal: controller.signal,
    });
    const rejection = expect(promise).rejects.toThrow(
      `${spawner} was cancelled`,
    );
    while (!existsSync(pidFile)) {
      await sleep(50);
    }
    controller.abort();
    await rejection;
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(await waitUntilGone(await readPid(pidFile))).toBe(true);
  }, 10_000);

  it("answers stdout and stderr of a subprocess that exits 0", async () => {
    expect(await execFile(okScript, [], { timeout: 5_000 })).toEqual({
      stdout: "out\n",
      stderr: "err\n",
    });
  }, 10_000);

  it("rejects with Node's error when the subprocess fails on its own", async () => {
    const error = await execFile(failScript, [], { timeout: 5_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 3, stderr: "boom\n" });
    const { message } = error as Error;
    expect(message.startsWith("Command failed: ")).toBe(true);
    expect(message).toContain("boom");
  }, 10_000);

  it("fails exactly as Node's execFile does when the subprocess exits on its own", async () => {
    const fields = [
      "message",
      "code",
      "killed",
      "signal",
      "cmd",
      "stdout",
      "stderr",
    ] as const;
    const catchError = (promise: Promise<unknown>) =>
      promise.then(
        () => {
          throw new Error("expected a rejection");
        },
        (e: unknown) => e as Record<string, unknown>,
      );
    const cases: [string, string[]][] = [
      [await script("exit3.sh", "echo o; echo boom >&2; exit 3"), ["x", "y"]],
      [await script("kill9.sh", "kill -9 $$"), []],
    ];
    for (const [path, args] of cases) {
      const ours = await catchError(execFile(path, args, { timeout: 5_000 }));
      const node = await catchError(
        promisify(execFileCb)(path, args, { encoding: "utf8" }),
      );
      for (const field of fields) {
        expect(ours[field], field).toEqual(node[field]);
      }
    }
  }, 10_000);

  it("fails as Node's execFile does when the program can't be started", async () => {
    const missing = join(dir, "missing");
    const error = await execFile(missing, ["a"], { timeout: 5_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: "ENOENT",
      message: `spawn ${missing} ENOENT`,
      stdout: "",
      stderr: "",
    });
  }, 10_000);

  it("fails, without blaming a timeout, when the subprocess prints more than 1 MiB", async () => {
    const big = await script(
      "big.sh",
      "head -c 2000000 /dev/zero | tr '\\0' x",
    );
    const error = await execFile(big, [], { timeout: 10_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: "stdout maxBuffer length exceeded",
    });
  }, 10_000);
});
