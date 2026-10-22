import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  CARGO_MIDEN_BUILD_TIMEOUT_MS,
  CARGO_TARGET_DIR,
  MIDEN_TOOL_TIMEOUT_MS,
} from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

const readCargoMidenVersion = async () => {
  const { stdout } = await execFile("cargo", ["miden", "--version"], {
    timeout: MIDEN_TOOL_TIMEOUT_MS,
  });
  const [, version = ""] = stdout.split(" ").map((part) => part.trim());
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${patch}`;
};

// The toolchain doesn't change while the server runs, so ask cargo once. A
// failure isn't cached: the next call asks again.
let cargoMidenVersionPromise: Promise<string> | undefined;
export const cargoMidenVersion = () => {
  cargoMidenVersionPromise ??= readCargoMidenVersion().catch((error) => {
    cargoMidenVersionPromise = undefined;
    throw error;
  });
  return cargoMidenVersionPromise;
};

// The lockfile cargo used to build `projectDir`, keyed by its path relative to
// `rootDir`. It sits at the root of the project's workspace, which may be above
// `projectDir`. Undefined when there is none, or it's outside `rootDir`.
export const readCargoLock = async ({
  projectDir,
  rootDir,
}: {
  projectDir: string;
  rootDir: string;
}) => {
  try {
    const { stdout } = await execFile(
      "cargo",
      ["locate-project", "--workspace", "--message-format", "plain"],
      { cwd: projectDir, timeout: MIDEN_TOOL_TIMEOUT_MS },
    );
    const lockPath = join(dirname(stdout.trim()), "Cargo.lock");
    // cargo answers with the canonical path (macOS's tmpdir is a symlink).
    const path = relative(await realpath(rootDir), lockPath);
    if (path.startsWith("..")) {
      return undefined;
    }
    return { path, content: await readFile(lockPath, "utf-8") };
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

// The package's directory under `MIDENC_TARGET_DIR`: cargo's profile name.
export const PROFILE_DIRS = { release: "release", debug: "dev" } as const;

export type BuildProfile = keyof typeof PROFILE_DIRS;

// Cargo and midenc name `--offline` in every failure it causes: a crate that
// isn't downloaded, or a missing Wasm target. Read from stderr only, since the
// error's message repeats the command line, which names the flag too.
const failedOffline = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "stderr" in error &&
  typeof error.stderr === "string" &&
  error.stderr.includes("--offline");

// `debug` is the dev profile, which keeps the debug info that names call-trace
// frames. midenc configures that profile itself with `--config` (overflow
// checks and debug assertions off, panic=abort), so it wraps on overflow like
// the release build and `CARGO_PROFILE_DEV_*` variables would change nothing.
//
// CARGO_TARGET_DIR is the warm cache: without it, midenc nests cargo's output
// under MIDENC_TARGET_DIR, which is per build, and every build starts cold.
// MIDENC_PACKAGE_CACHE stays unset, so each build stages its dependency
// packages in a directory of its own, never another request's.
//
// The build runs `--offline` first: cargo then resolves only against the crates
// the image downloaded, so a project without a Cargo.lock gets the warm
// versions instead of whatever crates.io has since published, which would
// rebuild the whole dependency tree. A project that needs a crate the image
// doesn't have fails offline, and builds again online.
export const cargoMidenBuild = async ({
  projectDir,
  midencTargetDir,
  profile = "release",
  signal,
}: {
  projectDir: string;
  midencTargetDir: string;
  profile?: BuildProfile;
  signal?: AbortSignal;
}) => {
  const run = (offline: boolean) =>
    execFile(
      "cargo",
      [
        "miden",
        "build",
        ...(profile === "release" ? ["--release"] : []),
        ...(offline ? ["--offline"] : []),
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CARGO_TARGET_DIR,
          MIDENC_TARGET_DIR: midencTargetDir,
        },
        timeout: CARGO_MIDEN_BUILD_TIMEOUT_MS,
        signal,
      },
    );
  try {
    const { stdout, stderr } = await run(true).catch((error: unknown) => {
      if (!failedOffline(error)) {
        throw error;
      }
      return run(false);
    });
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "cargo-miden failed";
    return { error: message };
  }
};
