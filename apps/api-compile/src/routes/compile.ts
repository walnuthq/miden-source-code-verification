import { Router } from "express";
import type { CompileResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";
import { type Assembly, queueAssemble } from "../lib/assemble.ts";
import { queueCompile } from "../lib/compile.ts";
import { serverTiming, type Timings } from "../lib/timings.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

// A MASM project's answer (the README of spec/remove-rust, "The MASM wire
// format"): its package and the assembler's report, with no storage schemas,
// no compiler MASM and its path on disk left out.
const assemblyResponse = (assembly: Assembly): CompileResponse => {
  const { stdout, stderr, diagnostics, builtWith } = assembly;
  if (!assembly.built) {
    return { built: false, stdout, stderr, diagnostics, builtWith };
  }
  const {
    masp,
    commitment,
    kind,
    manifest,
    readOnly,
    callsForeign,
    parameters,
    accountProcedures,
    files,
  } = assembly;
  return {
    built: true,
    stdout,
    stderr,
    masp,
    commitment,
    kind,
    manifest,
    readOnly,
    callsForeign,
    parameters,
    accountProcedures,
    files,
    diagnostics,
    builtWith,
  };
};

type CompileRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  warmLockfile?: boolean;
  masm?: boolean;
};

router.post("/compile", async (req, res) => {
  const { files, entrypoint, warmLockfile, masm } =
    req.body as CompileRequestBody;
  const opened = openProject(files, entrypoint, { masm: true });
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  const timings: Timings = {};
  if (opened.project.kind === "masm") {
    // One dev package, no lockfile, no compiler MASM: `warmLockfile` and
    // `masm` mean nothing here.
    const assembly = await queueAssemble(
      { project: opened.project, timings, signal: abortOnClose(res) },
      (assembly) => assembly,
    );
    res.set("Server-Timing", serverTiming(timings));
    res.json(assemblyResponse(assembly));
    return;
  }
  const build = await queueCompile(
    {
      project: opened.project,
      warmLockfile: warmLockfile === true,
      masm: masm === true,
      timings,
      signal: abortOnClose(res),
    },
    (build) => build,
  );
  // Where the request's time went, for whoever measures it from outside.
  res.set("Server-Timing", serverTiming(timings));
  // A failed build is an answer, with cargo-miden's diagnostics.
  if (!build.built) {
    res.json({
      built: false,
      stdout: build.stdout,
      stderr: build.stderr,
    } satisfies CompileResponse);
    return;
  }
  // Only what the build returns in memory: its path on disk stays out.
  const {
    stdout,
    stderr,
    masp,
    commitment,
    kind,
    manifest,
    readOnly,
    callsForeign,
    parameters,
    accountProcedures,
    storage,
    noteStorage,
    files: compiledFiles,
    masm: masmOutput,
  } = build;
  res.json({
    built: true,
    stdout,
    stderr,
    masp,
    commitment,
    kind,
    manifest,
    readOnly,
    callsForeign,
    parameters,
    accountProcedures,
    storage,
    noteStorage,
    files: compiledFiles,
    masm: masmOutput,
  } satisfies CompileResponse);
});

export default router;
