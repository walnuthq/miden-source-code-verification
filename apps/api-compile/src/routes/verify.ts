import { dirname, join } from "node:path";
import { Router } from "express";
import { queueCompile } from "@/lib/compile.js";
import { BusyError } from "@/lib/limiter.js";
import { abortOnClose, removeDirs } from "@/lib/utils.js";
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
  const signal = abortOnClose(res);
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
    const midenProjectTomlPath = join(entrypoint, "miden-project.toml");
    if (!files[midenProjectTomlPath]) {
      res.status(400).json({ error: "missing miden-project.toml" });
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
    // Verifying reads the built package from disk, so it runs before the
    // build's files are deleted.
    const result = await queueCompile(
      { files, entrypoint, signal },
      async ({
        stderr,
        maspPath,
        masp,
        digest,
        kind,
        manifest,
        files: compiledFiles,
      }) => {
        if (!maspPath) {
          return { error: stderr };
        }
        const resourcePath = resource
          ? await writeResourceFile(resource)
          : undefined;
        try {
          const verified = await verify({
            networkId,
            resourceId,
            resourcePath,
            maspPath,
            digest,
          });
          return {
            verified,
            masp,
            digest,
            kind,
            manifest,
            files: compiledFiles,
          };
        } finally {
          if (resourcePath) {
            await removeDirs([dirname(resourcePath)]);
          }
        }
      },
    );
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
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
      error instanceof Error ? error.message : "Verification failed";
    res.status(500).json({ error: message });
  }
});

export default router;
