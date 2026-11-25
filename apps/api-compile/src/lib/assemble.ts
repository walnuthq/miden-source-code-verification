import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BuildDiagnostic,
  BuiltPackage,
} from "miden-source-code-verification-utils/api-compile";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import type { Project } from "miden-source-code-verification-utils/project";
import {
  API_USER,
  ASSEMBLE_CONCURRENCY,
  ASSEMBLE_DEADLINE_MS,
  ASSEMBLE_QUEUE_SIZE,
  WORK_DIR,
} from "./constants.ts";
import { midenAssemble, midenPackageMetadata } from "./helper-tools.ts";
import { createLimiter } from "./limiter.ts";
import { type Timings, timed } from "./timings.ts";
import { chownTree, removeDirs, writeProjectFiles } from "./utils.ts";

// The MASM path of a build: a MASM project assembled by `miden-assemble` into
// one dev package, then read by `miden-package-metadata`. It runs no project
// code (docs/adr/0007-masm-builds-run-no-project-code.md), so it needs none of
// what isolates a cargo build in compile.ts: no view of the warm cache, no
// build user, no one-at-a-time slot, no retry, no second build. It is kept
// apart from compile.ts, whose cargo half goes once the Playground sends MASM.

type AssembleArgs = {
  // Already opened by the route as a MASM project.
  project: Project;
  // Filled with how long each part took: `assemble`, `tools` (reading the
  // package) and `cleanup`.
  timings?: Timings;
  signal?: AbortSignal;
};

// What the assembler adds to either outcome: its report, and its versions.
type AssemblyReport = { diagnostics: BuildDiagnostic[]; builtWith: string };

// What assembling a MASM project yields: built, with its package, or failed.
// Either way `stderr` is the report as the assembler renders it (empty for a
// build with no warnings) and `stdout` is empty: the wire format keeps the
// cargo path's two keys. A failed build is an outcome the routes answer, not
// an error.
export type Assembly =
  | ({ built: false; stdout: string; stderr: string } & AssemblyReport)
  | ({
      built: true;
      stdout: string;
      stderr: string;
      // The package on disk, for the verifier. Gone once `queueAssemble`'s
      // `use` returns.
      maspPath: string;
    } & BuiltPackage &
      AssemblyReport);

const deadlineError = () =>
  new HttpError(
    504,
    `the build did not finish within ${ASSEMBLE_DEADLINE_MS / 1000}s`,
  );

// Assembles in a fresh directory: the project in `project/`, the package next
// to it, outside the project root the assembler is confined to.
const assemble = async (
  { project: { files, entrypoint }, timings }: AssembleArgs,
  tmpDir: string,
  signal: AbortSignal,
): Promise<Assembly> => {
  const projectRoot = join(tmpDir, "project");
  const maspPath = join(tmpDir, "package.masp");
  await writeProjectFiles(projectRoot, files);
  // The server wrote the files; the tools run as another user, and the
  // assembler writes the package here.
  await chownTree(tmpDir, API_USER);
  const assembled = await timed(timings, "assemble", () =>
    midenAssemble({ projectRoot, entrypoint, maspPath, signal }),
  );
  if ("error" in assembled) {
    throw new Error(assembled.error);
  }
  const { built, builtWith, rendered, diagnostics } = assembled.output;
  const report = { stdout: "", stderr: rendered, diagnostics, builtWith };
  if (!built) {
    return { built: false, ...report };
  }
  const [maspBuffer, metadata] = await timed(timings, "tools", () =>
    Promise.all([
      readFile(maspPath),
      midenPackageMetadata(maspPath, {
        entrypointDir: join(projectRoot, entrypoint),
        signal,
      }),
    ]),
  );
  if ("error" in metadata) {
    throw new Error(metadata.error);
  }
  // A MASM package has no storage schemas: nothing of them is answered.
  const {
    commitment,
    kind,
    manifest,
    readOnly = {},
    callsForeign = {},
    parameters,
    accountProcedures,
  } = metadata.output;
  return {
    built: true,
    ...report,
    maspPath,
    masp: maspBuffer.toString("base64"),
    commitment,
    kind,
    manifest,
    readOnly,
    callsForeign,
    parameters,
    accountProcedures,
    // There is no lockfile to add: the project comes back as sent.
    files,
  };
};

const limit = createLimiter({
  concurrency: ASSEMBLE_CONCURRENCY,
  queueSize: ASSEMBLE_QUEUE_SIZE,
});

// Assembles once a slot is free (throws `BusyError` when the queue is full)
// and passes the outcome to `use`, in the slot. The build's directory is
// deleted once `use` returns: it has to be done with `maspPath` by then. The
// deadline, started once the slot is taken, covers `use` too, so a verifier
// that hangs answers 504 like an assembler that does.
export const queueAssemble = <T>(
  args: AssembleArgs,
  use: (assembly: Assembly, signal: AbortSignal) => Promise<T> | T,
) =>
  limit(async () => {
    const deadline = AbortSignal.timeout(ASSEMBLE_DEADLINE_MS);
    const signal = args.signal
      ? AbortSignal.any([args.signal, deadline])
      : deadline;
    await mkdir(join(WORK_DIR, "projects"), { recursive: true });
    const tmpDir = await mkdtemp(join(WORK_DIR, "projects", "miden-masm-"));
    try {
      const assembly = await assemble(args, tmpDir, signal);
      // A tool the deadline cut short fails with its own message: the answer
      // is the deadline, not that.
      if (deadline.aborted) {
        throw deadlineError();
      }
      return await use(assembly, signal);
    } catch (error) {
      throw deadline.aborted ? deadlineError() : error;
    } finally {
      await timed(args.timings, "cleanup", () => removeDirs([tmpDir]));
    }
  }, args.signal);
