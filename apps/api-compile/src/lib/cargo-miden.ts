import { realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { readBuildOutput } from "./build-output.ts";
import {
  BUILD_USER,
  CARGO_MIDEN_BUILD_TIMEOUT_MS,
  CARGO_TARGET_DIR,
  MIDEN_TOOL_TIMEOUT_MS,
  WARM_CARGO_HOME,
} from "./constants.ts";
import { execFile } from "./utils.ts";

// Cargo runs the project's own code, so it gets as little of the server's as
// possible: the user it runs as (`BUILD_USER`) and an explicit environment,
// not the server's whole one. `home` is the build's HOME and TMPDIR, a
// directory of the build that is deleted with it; calls that run no project
// code (no build scripts) get none. On the host, with no build user, cargo
// keeps the server's HOME and the default TMPDIR.
const cargoOptions = ({
  home,
  env = {},
}: {
  home?: string;
  env?: Record<string, string>;
} = {}) => ({
  ...BUILD_USER,
  env: {
    PATH: process.env.PATH,
    ...(BUILD_USER
      ? { HOME: home ?? "/nonexistent", TMPDIR: home ?? "/nonexistent" }
      : { HOME: process.env.HOME }),
    CARGO_HOME: process.env.CARGO_HOME,
    RUSTUP_HOME: process.env.RUSTUP_HOME,
    RUSTUP_AUTO_INSTALL: process.env.RUSTUP_AUTO_INSTALL,
    CARGO_TARGET_DIR,
    ...env,
  },
});

const readCargoMidenVersion = async () => {
  const { stdout } = await execFile("cargo", ["miden", "--version"], {
    // Runs outside builds, when the build's copy of the cache may not exist
    // (or is being replaced), so it reads the image's read-only cargo home.
    ...cargoOptions(
      WARM_CARGO_HOME ? { env: { CARGO_HOME: WARM_CARGO_HOME } } : {},
    ),
    // The server's own directory isn't readable by the build user.
    cwd: "/",
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
  signal,
}: {
  projectDir: string;
  rootDir: string;
  signal?: AbortSignal;
}) => {
  try {
    const { stdout } = await execFile(
      "cargo",
      ["locate-project", "--workspace", "--message-format", "plain"],
      {
        ...cargoOptions(),
        cwd: projectDir,
        timeout: MIDEN_TOOL_TIMEOUT_MS,
        signal,
      },
    );
    const lockPath = join(dirname(stdout.trim()), "Cargo.lock");
    // cargo answers with the canonical path (macOS's tmpdir is a symlink).
    const realRoot = await realpath(rootDir);
    const path = relative(realRoot, lockPath);
    if (path.startsWith("..")) {
      return undefined;
    }
    return {
      path,
      content: await readBuildOutput(lockPath, realRoot, "utf-8"),
    };
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
//
// `warmLockfile`: a lockfile that pins other versions of the warm crates (a
// client's copy from before the examples' lockfiles were updated) fails offline
// too, and online it downloads and rebuilds every crate that differs: minutes,
// on a container that loses them when it sleeps. With `warmLockfile`, such a
// failure first re-resolves the lockfile offline (`cargo update --offline`,
// which can only pick the downloaded versions) and builds offline again; only
// a crate the image doesn't have at all still goes online. It changes the
// dependency versions the client sent, so `/verify`, which must build exactly
// what was submitted, never sets it.
//
// `masmDir`: also write the package's Miden Assembly, as text, to
// `<masmDir>/<package>.masm` (midenc's `--emit masm`). It must be an existing
// directory: midenc writes a file of that name otherwise. The package itself
// is byte-identical with or without it.
export const cargoMidenBuild = async ({
  projectDir,
  midencTargetDir,
  profile = "release",
  warmLockfile = false,
  masmDir,
  signal,
}: {
  projectDir: string;
  midencTargetDir: string;
  profile?: BuildProfile;
  warmLockfile?: boolean;
  masmDir?: string;
  signal?: AbortSignal;
}) => {
  const home = join(midencTargetDir, "home");
  const run = (offline: boolean) =>
    execFile(
      "cargo",
      [
        "miden",
        "build",
        ...(profile === "release" ? ["--release"] : []),
        ...(offline ? ["--offline"] : []),
        ...(masmDir ? ["--emit", `masm=${masmDir}`] : []),
      ],
      {
        ...cargoOptions({ home, env: { MIDENC_TARGET_DIR: midencTargetDir } }),
        cwd: projectDir,
        timeout: CARGO_MIDEN_BUILD_TIMEOUT_MS,
        signal,
      },
    );
  // Re-resolves the lockfile against the downloaded crates, then builds
  // offline again. Undefined when it can't: the online build runs instead.
  const runWarm = async () => {
    try {
      await execFile("cargo", ["update", "--offline"], {
        ...cargoOptions({ home }),
        cwd: projectDir,
        timeout: MIDEN_TOOL_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      // Some crate isn't downloaded at all: the online build fetches it.
      console.error(error);
      return undefined;
    }
    return run(true).catch((error: unknown) => {
      if (!failedOffline(error)) {
        throw error;
      }
      return undefined;
    });
  };
  try {
    const { stdout, stderr } = await run(true).catch(async (error: unknown) => {
      if (!failedOffline(error)) {
        throw error;
      }
      return (warmLockfile ? await runWarm() : undefined) ?? run(false);
    });
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "cargo-miden failed";
    return { error: message };
  }
};
