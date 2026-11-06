import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

// For the describe it's called in: a shell script named `name`, first on PATH,
// so a helper tool run in-process meets it instead of the real binary. The
// script behaves as its arguments say, so one fake covers every case.
export const useFakeTool = (name: string, script: string) => {
  const path = process.env.PATH ?? "";
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), `fake-${name}-`));
    await writeFile(join(dir, name), script, { mode: 0o755 });
    process.env.PATH = `${dir}:${path}`;
  });

  afterAll(async () => {
    process.env.PATH = path;
    await rm(dir, { recursive: true, force: true });
  });
};
