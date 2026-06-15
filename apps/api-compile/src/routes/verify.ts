import { join } from "node:path";
import { Router } from "express";
import { compile } from "@/lib/compile.js";
import { verify, writeResourceFile } from "@/lib/verify.js";

const router = Router();

type VerifyRequestBody = {
  files?: Record<string, string>;
  entrypoint?: string;
  networkId?: string;
  resourceId?: string;
  resource?: string;
};

router.post("/verify", async (req, res) => {
  try {
    const {
      files,
      entrypoint = ".",
      networkId,
      resourceId,
      resource,
    } = req.body as VerifyRequestBody;
    if (!files || typeof files !== "object") {
      res.status(400).json({ error: "missing files" });
      return;
    }
    const cargoTomlPath = join(entrypoint, "Cargo.toml");
    if (!files[cargoTomlPath]) {
      res.status(400).json({ error: "missing Cargo.toml" });
      return;
    }
    if (!networkId) {
      res.status(400).json({ error: "missing networkId" });
      return;
    }
    if (!resourceId) {
      res.status(400).json({ error: "missing resourceId" });
      return;
    }
    const [{ stderr, maspPath, masp, digest, manifest }, resourcePath] =
      await Promise.all([
        compile({
          files,
          entrypoint,
        }),
        resource ? writeResourceFile(resource) : undefined,
      ]);
    if (!maspPath) {
      res.status(400).json({ error: stderr });
      return;
    }
    const verified = await verify({
      networkId,
      resourceId,
      resourcePath,
      maspPath,
      digest,
    });
    res.json({ verified, masp, digest, manifest });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Verification failed";
    res.status(500).json({ error: message });
  }
});

export default router;
