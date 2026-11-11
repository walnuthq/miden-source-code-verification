import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import {
  cargoMidenBuild,
  cargoMidenVersion,
  PROFILE_DIRS,
  readCargoLock,
} from "./cargo-miden.ts";
import {
  CARGO_TARGET_DIR,
  COMPILE_CONCURRENCY,
  COMPILE_DEADLINE_MS,
  COMPILE_QUEUE_SIZE,
  MAX_DEBUG_MASP_BYTES,
  MAX_MASM_BYTES,
} from "./constants.ts";
import { midenPackageMetadata } from "./helper-tools.ts";
import { createLimiter } from "./limiter.ts";
import { removeDirs } from "./utils.ts";

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
const readMasm = async (masmPath: string): Promise<MasmOutput> => {
  try {
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
    if (cargoMidenError) {
      return { error: cargoMidenError };
    }
    const maspPath = `${midencTargetDir}/${PROFILE_DIRS.debug}/${packageName}.masp`;
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
  const projectDir = join(tmpDir, entrypoint);
  // Under the build's own output directory, so `cleanup` deletes it.
  const masmDir = masm ? `${midencTargetDir}/masm` : undefined;
  if (masmDir) {
    await mkdir(masmDir, { recursive: true });
  }
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
  if (cargoMidenError) {
    return { built: false, stdout, stderr: cargoMidenError };
  }
  const maspPath = `${midencTargetDir}/${PROFILE_DIRS.release}/${packageName}.masp`;
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
      masmDir ? readMasm(`${masmDir}/${packageName}.masm`) : undefined,
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

// Builds in a fresh copy of the project, into its own output directory. Both
// are deleted by `cleanup`, or right away if the build throws: nothing reuses
// them, and left behind they'd fill the disk.
const compile = async (args: CompileArgs) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-project-"));
  // One target dir per request, named after the temp dir (mkdtemp's suffix is
  // mixed-case, so keep it as is: lowercasing it could make two names clash).
  const outputName = (tmpDir.split("/").at(-1) ?? "").replaceAll("-", "_");
  const midencTargetDir = `${CARGO_TARGET_DIR}/${outputName}`;
  const cleanup = () => removeDirs([tmpDir, midencTargetDir]);
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

const limit = createLimiter({
  concurrency: COMPILE_CONCURRENCY,
  queueSize: COMPILE_QUEUE_SIZE,
});

// Compiles once a slot is free (throws `BusyError` when the queue is full),
// passes the build to `use`, then deletes its files. `use` has to be done
// with `maspPath` when it returns.
export const queueCompile = async <T>(
  args: CompileArgs,
  use: (build: Build) => Promise<T> | T,
) => {
  const { build, cleanup } = await limit(() => compile(args), args.signal);
  try {
    return await use(build);
  } finally {
    await cleanup();
  }
};
