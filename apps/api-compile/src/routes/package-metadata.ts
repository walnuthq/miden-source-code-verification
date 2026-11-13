import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express, { Router } from "express";
import type { PackageMetadataResponse } from "miden-source-code-verification-utils/api-compile";
import { API_USER, WORK_DIR } from "../lib/constants.ts";
import { midenPackageMetadata } from "../lib/helper-tools.ts";
import { chownTree, removeDirs } from "../lib/utils.ts";

const router = Router();

// Above the largest release builds (a few hundred KB) with room to spare.
const MAX_MASP_SIZE = "10mb";

// The metadata of a package api-compile is sent, as `/compile` returns it for
// one it builds: `commitment`, `kind`, `manifest`, `readOnly`, and `storage`
// or `noteStorage` when the package has them (`PackageMetadataResponse`). For
// the registry's backfill of what it didn't store before (the storage
// schemas): read from the `.masp` alone, so nothing is rebuilt and it doesn't
// wait for the build queue. The body is the raw `.masp`, as base64 in JSON
// would push a large one past the JSON limit.
router.post(
  "/package-metadata",
  express.raw({ type: "application/octet-stream", limit: MAX_MASP_SIZE }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "missing masp" });
      return;
    }
    await mkdir(join(WORK_DIR, "resources"), { recursive: true });
    const dir = await mkdtemp(join(WORK_DIR, "resources", "package-metadata-"));
    try {
      const maspPath = join(dir, "package.masp");
      await writeFile(maspPath, req.body);
      // The tool reads it as another user than the server.
      await chownTree(dir, API_USER);
      const metadata = await midenPackageMetadata(maspPath);
      if ("error" in metadata) {
        // What the tool rejects is the package it was sent.
        res.status(400).json({ error: metadata.error });
        return;
      }
      // As `/compile` reads it.
      const { readOnly = {}, ...output } = metadata.output;
      res.json({ ...output, readOnly } satisfies PackageMetadataResponse);
    } finally {
      await removeDirs([dir]);
    }
  },
);

export default router;
