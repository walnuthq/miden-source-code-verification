import { Router } from "express";
import type { CompileResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";
import { queueCompile } from "../lib/compile.ts";
import { serverTiming, type Timings } from "../lib/timings.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

type CompileRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  debug?: boolean;
  warmLockfile?: boolean;
  masm?: boolean;
};

router.post("/compile", async (req, res) => {
  const { files, entrypoint, debug, warmLockfile, masm } =
    req.body as CompileRequestBody;
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  const timings: Timings = {};
  const build = await queueCompile(
    {
      project: opened.project,
      debug: debug === true,
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
    accountProcedures,
    storage,
    noteStorage,
    files: compiledFiles,
    debug: debugBuild,
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
    accountProcedures,
    storage,
    noteStorage,
    files: compiledFiles,
    debug: debugBuild,
    masm: masmOutput,
  } satisfies CompileResponse);
});

export default router;
