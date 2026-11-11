import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it(
    "kills what the subprocess started when it times out",
    async () => {
      const pidFile = newPidFile();
      const start = performance.now();
      await expect(
        execFile(spawner, [pidFile], { timeout: 500 }),
      ).rejects.toThrow(`${spawner} timed out after 0.5s`);
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(await waitUntilGone(await readPid(pidFile))).toBe(true);
    },
    10_000,
  );

  it(
    "kills what the subprocess started when it is cancelled",
    async () => {
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
    },
    10_000,
  );

  it(
    "answers stdout and stderr of a subprocess that exits 0",
    async () => {
      expect(await execFile(okScript, [], { timeout: 5_000 })).toEqual({
        stdout: "out\n",
        stderr: "err\n",
      });
    },
    10_000,
  );

  it(
    "rejects with Node's error when the subprocess fails on its own",
    async () => {
      const error = await execFile(failScript, [], { timeout: 5_000 }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: 3, stderr: "boom\n" });
      const { message } = error as Error;
      expect(message.startsWith("Command failed: ")).toBe(true);
      expect(message).toContain("boom");
    },
    10_000,
  );
});
