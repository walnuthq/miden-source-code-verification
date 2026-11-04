import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { Router } from "express";
import { midenPackageMetadata } from "../lib/miden-package-metadata.ts";
import { removeDirs } from "../lib/utils.ts";

const router = Router();

// Above the largest release builds (a few hundred KB) with room to spare.
const MAX_MASP_SIZE = "10mb";

// The metadata of a package api-compile is sent, as `/compile` returns it for
// one it builds: `commitment`, `kind`, `manifest` and `readOnly`. For the
// registry's backfill of what it didn't store before (`readOnly`): read from
// the `.masp` alone, so nothing is rebuilt and it doesn't wait for the build
// queue. The body is the raw `.masp`, as base64 in JSON would push a large
// one past the JSON limit.
router.post(
  "/package-metadata",
  express.raw({ type: "application/octet-stream", limit: MAX_MASP_SIZE }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "missing masp" });
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "package-metadata-"));
    try {
      const maspPath = join(dir, "package.masp");
      await writeFile(maspPath, req.body);
      const { stdout, error } = await midenPackageMetadata(maspPath);
      if (error !== undefined) {
        // What the tool rejects is the package it was sent.
        res.status(400).json({ error });
        return;
      }
      res.type("application/json").send(stdout);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "package metadata failed";
      res.status(500).json({ error: message });
    } finally {
      await removeDirs([dir]);
    }
  },
);

export default router;
