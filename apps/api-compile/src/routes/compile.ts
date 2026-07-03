import { join } from "node:path";
import { Router } from "express";
import { compile } from "@/lib/compile.js";

const router = Router();

type CompileRequestBody = {
  files?: Record<string, string>;
  entrypoint?: string;
};

router.post("/compile", async (req, res) => {
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
    const { stdout, stderr, masp, digest, manifest } = await compile({
      files,
      entrypoint,
    });
    res.json({
      stdout,
      stderr,
      masp,
      digest,
      manifest,
    });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Compilation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
