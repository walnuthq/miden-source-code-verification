import {
  chmod,
  chown,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  BuiltPackage,
  DebugBuild,
  MasmOutput,
} from "miden-source-code-verification-utils/api-compile";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import {
  type Manifest,
  procedureExportPaths,
} from "miden-source-code-verification-utils/manifest";
import type { Project } from "miden-source-code-verification-utils/project";
import { checkBuildOutput, killBuildUserProcesses } from "./build-output.ts";
import {
  cargoMidenBuild,
  cargoMidenVersion,
  PROFILE_DIRS,
  readCargoLock,
} from "./cargo-miden.ts";
import {
  BUILD_USER,
  CARGO_HOME,
  CARGO_TARGET_DIR,
  COMPILE_CONCURRENCY,
  COMPILE_DEADLINE_MS,
  COMPILE_QUEUE_SIZE,
  MAX_DEBUG_MASP_BYTES,
  MAX_MASM_BYTES,
  MIDEN_TOOL_TIMEOUT_MS,
  WARM_CACHE_DIR,
  WORK_DIR,
} from "./constants.ts";
import { midenPackageMetadata } from "./helper-tools.ts";
import { createLimiter } from "./limiter.ts";
import { chownTree, execFile, removeDirs } from "./utils.ts";

type CompileArgs = {
  // Already opened by the route: its files are clean project-relative paths,
  // its entrypoint is normalized and names the package.
  project: Project;
  // Also build the debug variant, right after the release build.
  debug?: boolean;
  // Only build the debug variant when the release build has this commitment,
  // i.e. when the toolchain still reproduces a stored package.
  expectedCommitment?: string;
  // Re-resolve a lockfile that pins crates the image doesn't have against the
  // ones it has, before building online (see `cargoMidenBuild`). The returned
  // `files` then carry the updated lockfile.
  warmLockfile?: boolean;
  // Also return the release build's Miden Assembly, as text.
  masm?: boolean;
  signal?: AbortSignal;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

// The release build's Miden Assembly, as a `MasmOutput`: a failure never fails
// the request it's part of.
const readMasm = async (
  masmPath: string,
  rootDir: string,
): Promise<MasmOutput> => {
  try {
    await checkBuildOutput(masmPath, rootDir);
    const { size } = await stat(masmPath);
    if (size > MAX_MASM_BYTES) {
      return { error: "masm too large" };
    }
    return { source: await readFile(masmPath, "utf-8") };
  } catch (error) {
    // The message would name the server's paths.
    console.error(error);
    return { error: "masm unavailable" };
  }
};

// A debug build of the same sources, as a `DebugBuild`: a failure never fails
// the request it's part of.
const buildDebug = async ({
  projectDir,
  midencTargetDir,
  packageName,
  releaseManifest,
  builtWith,
  signal,
}: {
  projectDir: string;
  midencTargetDir: string;
  packageName: string;
  releaseManifest: Manifest;
  builtWith?: string;
  signal?: AbortSignal;
}): Promise<DebugBuild> => {
  try {
    const { error: cargoMidenError } = await cargoMidenBuild({
      projectDir,
      midencTargetDir,
      profile: "debug",
      signal,
    });
    // Before anything reads its outputs: see `buildProject`.
    await killBuildUserProcesses();
    if (cargoMidenError) {
      return { error: cargoMidenError };
    }
    const maspPath = `${midencTargetDir}/${PROFILE_DIRS.debug}/${packageName}.masp`;
    // Answers the generic failure: a new message would be a new contract.
    if (
      !(await checkBuildOutput(maspPath, midencTargetDir).then(
        () => true,
        () => false,
      ))
    ) {
      return { error: "debug build failed" };
    }
    // Checked before reading it: the registry holds the whole response in
    // memory, base64-encoded.
    const { size } = await stat(maspPath);
    if (size > MAX_DEBUG_MASP_BYTES) {
      return { error: "debug build too large" };
    }
    const [maspBuffer, metadata] = await Promise.all([
      readFile(maspPath),
      midenPackageMetadata(maspPath, signal),
    ]);
    if ("error" in metadata) {
      return { error: metadata.error };
    }
    const { commitment, manifest } = metadata.output;
    // The simulator pairs the two builds' procedures by export path.
    const debugPaths = new Set(procedureExportPaths(manifest));
    if (
      !procedureExportPaths(releaseManifest).every((path) =>
        debugPaths.has(path),
      )
    ) {
      return { error: "debug build exports differ" };
    }
    return {
      masp: maspBuffer.toString("base64"),
      commitment,
      manifest,
      cargoMidenVersion: builtWith,
    };
  } catch (error) {
    return { error: errorMessage(error, "debug build failed") };
  }
};

// What compiling a project yields: built, with its package and cargo-miden's
// output, or failed, with the output alone. A failed build is an outcome the
// routes answer, not an error.
export type Build =
  | { built: false; stdout: string; stderr: string }
  | ({
      built: true;
      stdout: string;
      stderr: string;
      // The package on disk, for the verifier. Gone once `queueCompile`'s
      // `use` returns.
      maspPath: string;
      // The cargo-miden that built it, when its version could be read.
      cargoMidenVersion?: string;
      // Set when `expectedCommitment` was given and the build doesn't match
      // it.
      drift: boolean;
      // Set when `debug` was requested, unless the build drifted.
      debug?: DebugBuild;
      // Set when `masm` was requested.
      masm?: MasmOutput;
    } & BuiltPackage);

const buildProject = async ({
  project: { files, entrypoint, name: packageName },
  debug = false,
  expectedCommitment,
  warmLockfile,
  masm = false,
  signal,
  tmpDir,
  midencTargetDir,
}: CompileArgs & {
  tmpDir: string;
  midencTargetDir: string;
}): Promise<Build> => {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(tmpDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  // The files were written by the server, the build runs as another user.
  await chownTree(tmpDir, BUILD_USER);
  const projectDir = join(tmpDir, entrypoint);
  // Under the build's own output directory, so `cleanup` deletes it.
  const masmDir = masm ? `${midencTargetDir}/masm` : undefined;
  if (masmDir) {
    await mkdir(masmDir, { recursive: true });
  }
  // The build's HOME and TMPDIR (see `cargoOptions`): deleted with the rest of
  // its output, so nothing it writes there reaches the next build.
  await mkdir(join(midencTargetDir, "home"), { recursive: true });
  await chownTree(midencTargetDir, BUILD_USER);
  const {
    stdout = "",
    stderr = "",
    error: cargoMidenError,
  } = await cargoMidenBuild({
    projectDir,
    midencTargetDir,
    warmLockfile,
    masmDir,
    signal,
  });
  // A process the build left running could rewrite the outputs after they're
  // checked, or reach the next build: none survives the build.
  await killBuildUserProcesses();
  if (cargoMidenError) {
    return { built: false, stdout, stderr: cargoMidenError };
  }
  const maspPath = `${midencTargetDir}/${PROFILE_DIRS.release}/${packageName}.masp`;
  // `midenPackageMetadata`, and `miden-verifier` after it, read the same file.
  await checkBuildOutput(maspPath, midencTargetDir);
  const [maspBuffer, metadata, cargoLock, builtWith, masmOutput] =
    await Promise.all([
      readFile(maspPath),
      midenPackageMetadata(maspPath, signal),
      readCargoLock({ projectDir, rootDir: tmpDir, signal }),
      // No signal: the version is asked once per process and shared.
      cargoMidenVersion().catch((error) => {
        console.error(error);
        return undefined;
      }),
      masmDir
        ? readMasm(`${masmDir}/${packageName}.masm`, midencTargetDir)
        : undefined,
    ]);
  if ("error" in metadata) {
    throw new Error(metadata.error);
  }
  const { commitment, kind, manifest, readOnly = {} } = metadata.output;
  const drift =
    expectedCommitment !== undefined &&
    expectedCommitment.toLowerCase() !== commitment.toLowerCase();
  // In the same queue slot as the release build, so it runs warm right after
  // it, on the same sources and lockfile.
  const debugBuild =
    debug && !drift
      ? await buildDebug({
          projectDir,
          midencTargetDir,
          packageName,
          releaseManifest: manifest,
          builtWith,
          signal,
        })
      : undefined;
  // The debug build ran build code again, which could have replaced the release
  // package after it was read: the verifier reads `maspPath`, so it must still
  // be the package this answer returns. No build user process is left to
  // change it after this check.
  if (debugBuild) {
    await checkBuildOutput(maspPath, midencTargetDir);
    if (!(await readFile(maspPath)).equals(maspBuffer)) {
      throw new Error("build output changed after it was read");
    }
  }
  return {
    built: true,
    stdout,
    stderr,
    maspPath,
    masp: maspBuffer.toString("base64"),
    commitment,
    kind,
    manifest,
    readOnly,
    cargoMidenVersion: builtWith,
    drift,
    debug: debugBuild,
    masm: masmOutput,
    // The sources with the lockfile cargo created or updated, so a client can
    // resubmit them and get the same dependency versions next time.
    files: cargoLock
      ? { ...files, [cargoLock.path]: cargoLock.content }
      : files,
  };
};

const deadlineError = () =>
  new HttpError(
    504,
    `the build did not finish within ${COMPILE_DEADLINE_MS / 1000}s`,
  );

// Replaces the build's cache directories with fresh copies of the image's
// read-only warm cache, at the same paths (cargo's fingerprints record them).
// The copy runs as the build user, so it owns the result with no chown pass,
// and `cp -a` keeps the modes and timestamps the fingerprints need. Nothing
// happens on the host, which builds against CARGO_TARGET_DIR directly.
const copyWarmCache = async () => {
  if (WARM_CACHE_DIR === undefined || BUILD_USER === undefined) {
    return;
  }
  const start = performance.now();
  const pairs = [
    [join(WARM_CACHE_DIR, "target"), CARGO_TARGET_DIR],
    [join(WARM_CACHE_DIR, "cargo-home"), CARGO_HOME],
  ] as const;
  for (const [source, destination] of pairs) {
    if (destination === undefined) {
      continue;
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination);
    await chown(destination, BUILD_USER.uid, BUILD_USER.gid);
    await execFile("cp", ["-a", `${source}/.`, destination], {
      ...BUILD_USER,
      cwd: "/",
      env: { PATH: process.env.PATH },
      timeout: MIDEN_TOOL_TIMEOUT_MS,
    });
  }
  console.info(
    `build cache copied in ${Math.round(performance.now() - start)} ms`,
  );
};

// Builds in a fresh copy of the project, into its own output directory. Both
// are deleted by `cleanup`, or right away if the build throws: nothing reuses
// them, and left behind they'd fill the disk.
const compile = async (args: CompileArgs) => {
  // Whatever an earlier `cargo` call left running or lying in /tmp goes first.
  await killBuildUserProcesses();
  // A failed copy fails the request: never build against a partial cache.
  await copyWarmCache();
  await mkdir(join(WORK_DIR, "projects"), { recursive: true });
  const tmpDir = await mkdtemp(join(WORK_DIR, "projects", "miden-project-"));
  // Only the build user may enter its project: no other request's files, and
  // no shared parent, are in reach of the code it runs.
  await chmod(tmpDir, 0o700);
  // One target dir per request, named after the temp dir (mkdtemp's suffix is
  // mixed-case, so keep it as is: lowercasing it could make two names clash).
  const outputName = (tmpDir.split("/").at(-1) ?? "").replaceAll("-", "_");
  const midencTargetDir = `${CARGO_TARGET_DIR}/${outputName}`;
  // With a warm cache copy, the copies go too, so they don't sit on disk
  // between requests. On the host CARGO_TARGET_DIR is the shared cache: never
  // delete it.
  const cleanup = () =>
    removeDirs([
      tmpDir,
      midencTargetDir,
      ...(WARM_CACHE_DIR === undefined
        ? []
        : [
            CARGO_TARGET_DIR,
            ...(CARGO_HOME === undefined ? [] : [CARGO_HOME]),
          ]),
    ]);
  // Started once the slot is taken: time spent queued doesn't count.
  const deadline = AbortSignal.timeout(COMPILE_DEADLINE_MS);
  const signal = args.signal
    ? AbortSignal.any([args.signal, deadline])
    : deadline;
  try {
    const build = await buildProject({
      ...args,
      signal,
      tmpDir,
      midencTargetDir,
    });
    // A build the deadline ended comes back as a failed build, or throws from
    // a tool it cut short: either way the answer is the deadline, not that.
    if (deadline.aborted) {
      throw deadlineError();
    }
    return { build, cleanup };
  } catch (error) {
    await cleanup();
    throw deadline.aborted ? deadlineError() : error;
  }
};

// The cache is copied for the build user, at the paths cargo uses.
if (
  WARM_CACHE_DIR !== undefined &&
  (BUILD_USER === undefined || CARGO_HOME === undefined)
) {
  throw new Error(
    "WARM_CACHE_DIR needs BUILD_UID/BUILD_GID and CARGO_HOME: the cache is copied for the build user, at the paths cargo uses",
  );
}

// One build at a time is what isolates builds from each other: after each
// build every process of the one build user is killed and its temp files
// deleted, which would hit a concurrent build too.
if (BUILD_USER !== undefined && COMPILE_CONCURRENCY > 1) {
  throw new Error(
    "COMPILE_CONCURRENCY must be 1 when builds run as BUILD_UID: one build user can't be isolated from itself",
  );
}

const limit = createLimiter({
  concurrency: COMPILE_CONCURRENCY,
  queueSize: COMPILE_QUEUE_SIZE,
});

// Compiles once a slot is free (throws `BusyError` when the queue is full),
// passes the build to `use`, then deletes its files, all in the slot: each
// build replaces the cache copy the previous build's package lives in, so the
// next build may start only once this one's package has been used and deleted.
// `use` has to be done with `maspPath` when it returns.
export const queueCompile = async <T>(
  args: CompileArgs,
  use: (build: Build) => Promise<T> | T,
) =>
  limit(async () => {
    const { build, cleanup } = await compile(args);
    try {
      return await use(build);
    } finally {
      await cleanup();
    }
  }, args.signal);
