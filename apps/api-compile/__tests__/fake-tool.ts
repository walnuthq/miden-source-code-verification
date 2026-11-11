import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

// For the describe it's called in: a shell script named `name`, first on PATH,
// so a helper tool run in-process meets it instead of the real binary. The
// script behaves as its arguments say, so one fake covers every case. Fakes
// compose: each adds its own directory to the PATH as it is when the describe
// starts, and removes only that directory when it ends.
export const useFakeTool = (name: string, script: string) => {
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), `fake-${name}-`));
    await writeFile(join(dir, name), script, { mode: 0o755 });
    process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
  });

  afterAll(async () => {
    process.env.PATH = (process.env.PATH ?? "")
      .split(":")
      .filter((entry) => entry !== dir)
      .join(":");
    await rm(dir, { recursive: true, force: true });
  });
};
