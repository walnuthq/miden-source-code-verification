import { Router } from "express";
import { getPackage } from "@/db/packages.js";
import { getMaspStore, maspKey, parseMaspKey } from "@/storage/masp-store.js";

const router: Router = Router();

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
 *
 *       Request `{packageCommitment}.debug.masp` instead for the package's
 *       **debug build**: the same sources built with the dev profile
 *       (`cargo miden build` without `--release`), whose debug info names
 *       call-trace frames. It has its own commitment, sent in
 *       `X-Debug-Commitment`, and other procedure roots: it isn't the deployed
 *       code and doesn't verify anything. `{packageCommitment}` is still the
 *       release build's.
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
 *           matched case-insensitively — of the release build, also for its
 *           `.debug.masp` form.
 *     responses:
 *       "200":
 *         description: The compiled package, or its debug build.
 *         headers:
 *           X-Debug-Commitment:
 *             description: >
 *               The debug build's own commitment (32-byte hex). Only sent for
 *               a `.debug.masp`.
 *             schema:
 *               type: string
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       "400":
 *         description: >
 *           Invalid file name (not `<32-byte hex commitment>.masp` or
 *           `<32-byte hex commitment>.debug.masp`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "404":
 *         description: >
 *           No package recorded for the given commitment, or, for a
 *           `.debug.masp`, no debug build of it yet.
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
    // Parsed here rather than as an Express `:param.masp` pattern so a
    // malformed name gets a clear 400 instead of a 404.
    const key = parseMaspKey(req.params.file);
    if (!key) {
      res.status(400).json({ error: "invalid package commitment" });
      return;
    }
    const { commitment, variant } = key;
    let debugCommitment: string | null = null;
    if (variant === "debug") {
      // The row says whether there is a debug build, and gives its commitment.
      debugCommitment = (await getPackage(commitment))?.debugCommitment ?? null;
      if (!debugCommitment) {
        res.status(404).json({ error: "package debug masp not found" });
        return;
      }
    }
    const masp = await getMaspStore(req).get(commitment, variant);
    if (!masp) {
      res.status(404).json({
        error:
          variant === "debug"
            ? "package debug masp not found"
            : "package masp not found",
      });
      return;
    }
    if (debugCommitment) {
      res.set("X-Debug-Commitment", debugCommitment);
    }
    res
      .attachment(maspKey(commitment, variant))
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
