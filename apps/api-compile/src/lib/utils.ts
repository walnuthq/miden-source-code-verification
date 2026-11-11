import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import type { Response } from "express";
import { SUBPROCESS_MAX_OUTPUT_BYTES } from "./constants.ts";

// Best effort: a failed cleanup is logged, never turned into a failed request.
export const removeDirs = async (dirs: string[]) => {
  try {
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  } catch (error) {
    console.error(error);
  }
};

// Every subprocess is bounded: a hung tool must fail its own request instead of
// holding the single container. On a timeout or an abort the error is replaced,
// so callers that prefer the tool's stderr don't surface partial output instead.
// The subprocess leads its own process group, so ending it ends everything it
// started: a signal to the subprocess alone leaves its children holding its
// output pipes and the call would never settle. The wrapper builds Node's
// execFile error itself because execFile can't start a process group, and
// ADR 0005 needs that error unchanged. The size-limit error is the wrapper's
// own (it names the tool and the limit); only the error of a subprocess that
// fails on its own is Node's, unchanged.
export const execFile = (
  file: string,
  args: string[],
  {
    timeout,
    cwd,
    env,
    signal,
    maxBuffer = SUBPROCESS_MAX_OUTPUT_BYTES,
  }: {
    timeout: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    maxBuffer?: number;
  },
) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${file} was cancelled`));
      return;
    }
    const child = spawn(file, args, { cwd, env, detached: true });
    const cmd = [file, ...args].join(" ");
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const sizes = { stdout: 0, stderr: 0 };
    const output = () => ({
      stdout: Buffer.concat(chunks.stdout).toString("utf8"),
      stderr: Buffer.concat(chunks.stderr).toString("utf8"),
    });
    let settled = false;
    const killGroup = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The group is already gone.
        }
      }
    };
    const onAbort = () => {
      killGroup();
      settle(() => reject(new Error(`${file} was cancelled`)), true);
    };
    const timer = setTimeout(() => {
      killGroup();
      settle(
        () => reject(new Error(`${file} timed out after ${timeout / 1000}s`)),
        true,
      );
    }, timeout);
    const settle = (done: () => void, destroyPipes = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (destroyPipes) {
        // A process that left the group must not keep the call pending.
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      done();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }
        const room = maxBuffer - sizes[stream];
        if (chunk.length > room) {
          chunks[stream].push(chunk.subarray(0, room));
          sizes[stream] = maxBuffer;
          killGroup();
          settle(
            () =>
              reject(
                Object.assign(
                  new Error(
                    `${file} printed more than ${maxBuffer / 1024 / 1024} MiB`,
                  ),
                  {
                    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
                    cmd,
                    ...output(),
                  },
                ),
              ),
            true,
          );
          return;
        }
        chunks[stream].push(chunk);
        sizes[stream] += chunk.length;
      });
    }
    child.on("error", (error) => {
      settle(() => reject(Object.assign(error, { cmd, ...output() })));
    });
    child.on("close", (code, exitSignal) => {
      settle(() => {
        const { stdout, stderr } = output();
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), {
            code,
            killed: false,
            signal: exitSignal,
            cmd,
            stdout,
            stderr,
          }),
        );
      });
    });
  });

// Aborts when the client goes away before the response is sent, so a request
// nobody is waiting for anymore leaves the compile queue or kills its build.
export const abortOnClose = (res: Response) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
};
