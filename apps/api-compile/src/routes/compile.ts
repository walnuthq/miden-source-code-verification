import { join } from "node:path";
import { Router } from "express";
import { queueCompile } from "../lib/compile.ts";
import { BusyError } from "../lib/limiter.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

type CompileRequestBody = {
  files?: Record<string, string>;
  entrypoint?: string;
  debug?: boolean;
  warmLockfile?: boolean;
  masm?: boolean;
};

router.post("/compile", async (req, res) => {
  const signal = abortOnClose(res);
  try {
    const {
      files,
      entrypoint = ".",
      debug,
      warmLockfile,
      masm,
    } = req.body as CompileRequestBody;
    if (!files || typeof files !== "object") {
      res.status(400).json({ error: "missing files" });
      return;
    }
    const cargoTomlPath = join(entrypoint, "Cargo.toml");
    if (!files[cargoTomlPath]) {
      res.status(400).json({ error: "missing Cargo.toml" });
      return;
    }
    const midenProjectTomlPath = join(entrypoint, "miden-project.toml");
    if (!files[midenProjectTomlPath]) {
      res.status(400).json({ error: "missing miden-project.toml" });
      return;
    }
    // The response only needs what the build returns in memory.
    const {
      stdout,
      stderr,
      masp,
      commitment,
      kind,
      manifest,
      readOnly,
      files: compiledFiles,
      debug: debugBuild,
      masm: masmOutput,
    } = await queueCompile(
      {
        files,
        entrypoint,
        debug: debug === true,
        warmLockfile: warmLockfile === true,
        masm: masm === true,
        signal,
      },
      (compiled) => compiled,
    );
    res.json({
      stdout,
      stderr,
      masp,
      commitment,
      kind,
      manifest,
      // Set when the build succeeded: whether each exported procedure is
      // read-only, by export path (`ReadOnlyProcedures`).
      readOnly,
      // Set when the build succeeded: the sources plus the lockfile it used.
      files: compiledFiles,
      // Set when the build succeeded and `debug` was requested.
      debug: debugBuild,
      // Set when the build succeeded and `masm` was requested: `{ source }`,
      // the release build's Miden Assembly as text, or `{ error }`.
      masm: masmOutput,
    });
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    if (error instanceof BusyError) {
      res.status(503).set("Retry-After", "30").json({ error: error.message });
      return;
    }
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Compilation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
