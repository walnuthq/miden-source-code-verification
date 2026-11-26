import { Router } from "express";
import type { CompileResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";

import { type Assembly, queueAssemble } from "../lib/assemble.ts";
import { serverTiming, type Timings } from "../lib/timings.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

// The answer (the README of spec/remove-rust, "The MASM wire format"): the
// assembly without its path on disk.
const assemblyResponse = (assembly: Assembly): CompileResponse => {
  if (!assembly.built) {
    return assembly;
  }
  const { maspPath: _maspPath, ...response } = assembly;
  return response;
};

type CompileRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
};

// Anything else in the body, as the flags older clients send for Rust
// projects, is ignored.
router.post("/compile", async (req, res) => {
  const { files, entrypoint } = req.body as CompileRequestBody;
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  const timings: Timings = {};
  const assembly = await queueAssemble(
    { project: opened.project, timings, signal: abortOnClose(res) },
    (assembly) => assembly,
  );
  // Where the request's time went, for whoever measures it from outside.
  res.set("Server-Timing", serverTiming(timings));
  // A failed build is an answer too, with the assembler's diagnostics.
  res.json(assemblyResponse(assembly));
});

export default router;
