import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lodash from "lodash";
import { parseCargoToml } from "miden-source-code-verification-utils";
import type {
  Manifest,
  TargetType,
} from "miden-source-code-verification-utils/manifest";
import { cargoMidenBuild, readCargoLock } from "@/lib/cargo-miden.js";
import {
  CARGO_TARGET_DIR,
  COMPILE_CONCURRENCY,
  COMPILE_QUEUE_SIZE,
} from "@/lib/constants.js";
import { createLimiter } from "@/lib/limiter.js";
import { midenPackageMetadata } from "@/lib/miden-package-metadata.js";
import { removeDirs } from "@/lib/utils.js";

const { snakeCase } = lodash;

type CompileArgs = {
  files: Record<string, string>;
  entrypoint?: string;
  signal?: AbortSignal;
};

const build = async ({
  files,
  entrypoint = ".",
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
  const maspPath = `${midencTargetDir}/release/${packageName}.masp`;
  const [
    maspBuffer,
    {
      stdout: midenPackageMetadataStdout = "",
      error: midenPackageMetadataError,
    },
    cargoLock,
  ] = await Promise.all([
    readFile(maspPath),
    midenPackageMetadata(maspPath),
    readCargoLock({ projectDir, rootDir: tmpDir }),
  ]);
  if (midenPackageMetadataError) {
    throw new Error(midenPackageMetadataError);
  }
  const { digest, kind, manifest } = JSON.parse(midenPackageMetadataStdout) as {
    digest: string;
    kind: TargetType;
    manifest: Manifest;
  };
  return {
    stdout,
    stderr,
    maspPath,
    masp: maspBuffer.toString("base64"),
    digest,
    kind,
    manifest,
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
