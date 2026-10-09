import { Router } from "express";
import { getMaspStore, maspKey } from "@/storage/masp-store.js";

const router: Router = Router();

// `<commitment>.masp`, matched here rather than as an Express `:param.masp`
// pattern so a malformed name gets a clear 400 instead of a 404.
const MASP_FILE_PATTERN = /^(0x[0-9a-f]{64})\.masp$/i;

/**
 * @openapi
 * /v1/{networkId}/packages/masp/{packageCommitment}.masp:
 *   get:
 *     tags: [packages]
 *     summary: Download a package's compiled MASP
 *     description: >
 *       Returns the compiled Miden package (`.masp`) recorded for the given
 *       package commitment, as raw bytes. A package's commitment is the same on
 *       every network, so `networkId` doesn't affect the result; it is kept for
 *       consistency with the other endpoints.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`).
 *       - in: path
 *         name: packageCommitment
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[0-9a-fA-F]{64}$'
 *         description: >
 *           Package commitment — `0x` followed by 64 hex characters (32 bytes),
 *           matched case-insensitively.
 *     responses:
 *       "200":
 *         description: The compiled package.
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       "400":
 *         description: Invalid file name (not `<32-byte hex commitment>.masp`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "404":
 *         description: No package recorded for the given commitment.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "500":
 *         description: Retrieval failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get("/:networkId/packages/masp/:file", async (req, res) => {
  try {
    const commitment = MASP_FILE_PATTERN.exec(req.params.file)?.[1];
    if (!commitment) {
      res.status(400).json({ error: "invalid package commitment" });
      return;
    }
    const masp = await getMaspStore(req).get(commitment);
    if (!masp) {
      res.status(404).json({ error: "package masp not found" });
      return;
    }
    res
      .attachment(maspKey(commitment))
      .type("application/octet-stream")
      // Content-addressed: the artifact behind a commitment never changes.
      .set("Cache-Control", "public, max-age=31536000, immutable")
      .send(Buffer.from(masp));
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "package masp retrieval failed";
    res.status(500).json({ error: message });
  }
});

export default router;
