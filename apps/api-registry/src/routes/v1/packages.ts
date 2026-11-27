import { Router } from "express";
import { maspDownloadName, parseMaspKey } from "miden-source-code-verification-utils/api-registry";

import { getPackage } from "../../db/packages.ts";
import { getMaspStore } from "../../storage/masp-store.ts";

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
 *       consistency with the other endpoints. The package carries its debug
 *       info, which names call-trace frames by their source location.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
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
 *         headers:
 *           Content-Disposition:
 *             description: >
 *               `attachment`, with a file name taken from the package's name
 *               (from its `miden-project.toml`), each run of characters
 *               outside `[A-Za-z0-9.]` replaced by `_` and leading `_`
 *               dropped: `counter_contract.masp` for `counter-contract`. A
 *               package without a name keeps the requested file name
 *               (`{packageCommitment}.masp`).
 *             schema:
 *               type: string
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       "400":
 *         description: >
 *           Invalid file name (not `<32-byte hex commitment>.masp`).
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
  // Parsed here rather than as an Express `:param.masp` pattern so a
  // malformed name gets a clear 400 instead of a 404.
  const commitment = parseMaspKey(req.params.file);
  if (!commitment) {
    res.status(400).json({ error: "invalid package commitment" });
    return;
  }
  const masp = await getMaspStore(req).get(commitment);
  if (!masp) {
    res.status(404).json({ error: "package masp not found" });
    return;
  }
  // The row names the download.
  const dbPackage = await getPackage(commitment);
  res
    // Named after the package, so a cross-origin link (whose `download`
    // attribute browsers ignore) saves it as e.g. `counter_contract.masp`.
    // A nameless package, or a stored file without a row, keeps the
    // commitment-based name.
    .attachment(maspDownloadName(dbPackage?.name ?? "", commitment))
    .type("application/octet-stream")
    // Content-addressed: the artifact behind a commitment never changes.
    .set("Cache-Control", "public, max-age=31536000, immutable")
    .send(Buffer.from(masp));
});

export default router;
