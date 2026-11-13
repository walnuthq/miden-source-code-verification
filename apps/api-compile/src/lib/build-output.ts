import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { BUILD_USER, MIDEN_TOOL_TIMEOUT_MS } from "./constants.ts";
import { execFile } from "./utils.ts";

// Build code can write the directories its outputs land in, so it can swap an
// output for a symlink or a hard link to any file the root server can read
// (`/proc/1/environ`, say), which the server would then return as the package
// or the lockfile. An output is only read when it is the build user's own
// plain file, reached through no symlinked directory, under `rootDir`. The
// message never names the path: it would name the server's paths.
export const checkBuildOutput = async (
  path: string,
  rootDir: string,
  owner: { uid: number; gid: number } | undefined = BUILD_USER,
) => {
  const fail = () => new Error("build output is not a plain file");
  const inside = relative(rootDir, path);
  if (inside === "" || inside.startsWith("..")) {
    throw fail();
  }
  let stats: Awaited<ReturnType<typeof lstat>>;
  let resolved: string;
  let resolvedRoot: string;
  try {
    [stats, resolved, resolvedRoot] = await Promise.all([
      lstat(path),
      realpath(path),
      realpath(rootDir),
    ]);
  } catch {
    throw fail();
  }
  if (
    !stats.isFile() ||
    stats.nlink !== 1 ||
    (owner !== undefined && stats.uid !== owner.uid) ||
    resolved !== join(resolvedRoot, inside)
  ) {
    throw fail();
  }
};

// Reads a build output as text, once `checkBuildOutput` passes.
export const readBuildOutput = async (
  path: string,
  rootDir: string,
  encoding: BufferEncoding = "utf-8",
) => {
  await checkBuildOutput(path, rootDir);
  return readFile(path, encoding);
};

// Runs as the build user, from Node itself so it needs no shell. kill(-1)
// signals every process the caller may signal except itself: the build user's
// own. Then it deletes the build user's entries in the shared temp
// directories, which are sticky, so it can't touch anyone else's.
const KILL_AND_CLEAN_SCRIPT = `
const { lstatSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");
try { process.kill(-1, "SIGKILL"); } catch {}
const uid = process.getuid();
for (const dir of ["/tmp", "/var/tmp", "/dev/shm"]) {
  let names = [];
  try { names = readdirSync(dir); } catch {}
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (lstatSync(path).uid === uid) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {}
  }
}
`;

// Kills every process the build user has left running, and clears what it left
// in the shared temp directories. Builds take the one build slot
// (COMPILE_CONCURRENCY must be 1, see compile.ts), so none of them belongs to
// another request. A daemonised child of `build.rs` would otherwise outlive
// its build, free to rewrite the outputs just checked or poison the next build.
// Answers whether the sweep ran: a failure is logged, not thrown.
export const killBuildUserProcesses = async () => {
  if (!BUILD_USER) {
    return true;
  }
  try {
    await execFile(
      process.execPath,
      ["--input-type=commonjs", "-e", KILL_AND_CLEAN_SCRIPT],
      {
        ...BUILD_USER,
        cwd: "/",
        env: { PATH: process.env.PATH },
        timeout: MIDEN_TOOL_TIMEOUT_MS,
      },
    );
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};
