import { join } from "node:path";
import { Router } from "express";
import { queueCompile } from "@/lib/compile.js";
import { BusyError } from "@/lib/limiter.js";
import { abortOnClose } from "@/lib/utils.js";

const router = Router();

type CompileRequestBody = {
  files?: Record<string, string>;
  entrypoint?: string;
};

router.post("/compile", async (req, res) => {
  const signal = abortOnClose(res);
  try {
    const { files, entrypoint = "." } = req.body as CompileRequestBody;
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
    const { stdout, stderr, masp, digest, kind, manifest } = await queueCompile(
      {
        files,
        entrypoint,
        signal,
      },
      (compiled) => compiled,
    );
    res.json({
      stdout,
      stderr,
      masp,
      digest,
      kind,
      manifest,
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
