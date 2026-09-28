import {
  type ExecFileOptions,
  execFile as execFileCb,
} from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { Response } from "express";

const execFileAsync = promisify(execFileCb);

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
export const execFile = async (
  file: string,
  args: string[],
  {
    timeout,
    ...options
  }: Omit<ExecFileOptions, "encoding" | "timeout"> & { timeout: number },
) => {
  try {
    return await execFileAsync(file, args, {
      ...options,
      timeout,
      encoding: "utf8",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${file} was cancelled`);
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "killed" in error &&
      error.killed
    ) {
      throw new Error(`${file} timed out after ${timeout / 1000}s`);
    }
    throw error;
  }
};

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
