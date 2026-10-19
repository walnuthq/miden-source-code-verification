import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lodash from "lodash";
import { parseCargoToml } from "miden-source-code-verification-utils";
import {
  type Manifest,
  procedureExportPaths,
  type TargetType,
} from "miden-source-code-verification-utils/manifest";
import {
  cargoMidenBuild,
  cargoMidenVersion,
  PROFILE_DIRS,
  readCargoLock,
} from "@/lib/cargo-miden.js";
import {
  CARGO_TARGET_DIR,
  COMPILE_CONCURRENCY,
  COMPILE_QUEUE_SIZE,
  MAX_DEBUG_MASP_BYTES,
} from "@/lib/constants.js";
import { createLimiter } from "@/lib/limiter.js";
import { midenPackageMetadata } from "@/lib/miden-package-metadata.js";
import { removeDirs } from "@/lib/utils.js";

const { snakeCase } = lodash;

type CompileArgs = {
  files: Record<string, string>;
  entrypoint?: string;
  // Also build the debug variant, right after the release build.
  debug?: boolean;
  // Only build the debug variant when the release build has this commitment,
  // i.e. when the toolchain still reproduces a stored package.
  expectedCommitment?: string;
  signal?: AbortSignal;
};

// A debug build of the same sources: its package with debug info, which names
// call-trace frames but has other procedure roots than the release build. It
// never fails the request it's part of, so a failure is an `error`.
export type DebugBuild =
  | {
      masp: string;
      commitment: string;
      manifest: Manifest;
      cargoMidenVersion?: string;
    }
  | { error: string };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

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
    const [maspBuffer, { stdout = "", error: midenPackageMetadataError }] =
      await Promise.all([readFile(maspPath), midenPackageMetadata(maspPath)]);
    if (midenPackageMetadataError) {
      return { error: midenPackageMetadataError };
    }
    const { commitment, manifest } = JSON.parse(stdout) as {
      commitment: string;
      manifest: Manifest;
    };
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

const build = async ({
  files,
  entrypoint = ".",
  debug = false,
  expectedCommitment,
  signal,
  tmpDir,
  midencTargetDir,
}: CompileArgs & { tmpDir: string; midencTargetDir: string }) => {
  const cargoTomlPath = join(entrypoint, "Cargo.toml");
  const cargoToml = files[cargoTomlPath] ?? "";
  const {
    package: { name: packageName },
  } = parseCargoToml(cargoToml);
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(tmpDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  const projectDir = entrypoint ? `${tmpDir}/${entrypoint}` : tmpDir;
  const {
    stdout = "",
    stderr = "",
    error: cargoMidenError,
  } = await cargoMidenBuild({
    projectDir,
    midencTargetDir,
    signal,
  });
  if (cargoMidenError) {
    return {
      stdout,
      stderr: cargoMidenError,
    };
  }
  const maspPath = `${midencTargetDir}/${PROFILE_DIRS.release}/${packageName}.masp`;
  const [
    maspBuffer,
    {
      stdout: midenPackageMetadataStdout = "",
      error: midenPackageMetadataError,
    },
    cargoLock,
    builtWith,
  ] = await Promise.all([
    readFile(maspPath),
    midenPackageMetadata(maspPath),
    readCargoLock({ projectDir, rootDir: tmpDir }),
    cargoMidenVersion().catch((error) => {
      console.error(error);
      return undefined;
    }),
  ]);
  if (midenPackageMetadataError) {
    throw new Error(midenPackageMetadataError);
  }
  const { commitment, kind, manifest } = JSON.parse(
    midenPackageMetadataStdout,
  ) as {
    commitment: string;
    kind: TargetType;
    manifest: Manifest;
  };
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
    stdout,
    stderr,
    maspPath,
    masp: maspBuffer.toString("base64"),
    commitment,
    kind,
    manifest,
    cargoMidenVersion: builtWith,
    // Set when `expectedCommitment` was given and the build doesn't match it.
    drift,
    debug: debugBuild,
    // The sources with the lockfile cargo created or updated, so a client can
    // resubmit them and get the same dependency versions next time.
    files: cargoLock
      ? { ...files, [cargoLock.path]: cargoLock.content }
      : files,
  };
};

type Compiled = Awaited<ReturnType<typeof build>>;

// Builds in a fresh copy of the project, into its own output directory. Both
// are deleted by `cleanup`, or right away if the build throws: nothing reuses
// them, and left behind they'd fill the disk.
const compile = async (args: CompileArgs) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-project-"));
  const outputName = snakeCase(tmpDir.split("/").at(-1) ?? "");
  const midencTargetDir = `${CARGO_TARGET_DIR}/${outputName}`;
  const cleanup = () => removeDirs([tmpDir, midencTargetDir]);
  try {
    return { ...(await build({ ...args, tmpDir, midencTargetDir })), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
};

const limit = createLimiter({
  concurrency: COMPILE_CONCURRENCY,
  queueSize: COMPILE_QUEUE_SIZE,
});

// Compiles once a slot is free (throws `BusyError` when the queue is full),
// passes the result to `use`, then deletes the build's files. `use` has to be
// done with `maspPath` when it returns.
export const queueCompile = async <T>(
  args: CompileArgs,
  use: (compiled: Compiled) => Promise<T> | T,
) => {
  const { cleanup, ...compiled } = await limit(
    () => compile(args),
    args.signal,
  );
  try {
    return await use(compiled);
  } finally {
    await cleanup();
  }
};
