import { join } from "node:path";
import { Router } from "express";
import { getVerifiedAccount } from "@/db/verified-accounts.js";
import { verifyAccountComponent } from "@/lib/verify-account-component.js";

const router: Router = Router();

type VerifyAccountRequestBody = {
  accountId?: string;
  files?: Record<string, string>;
  entrypoint?: string;
  source?: string;
};

/**
 * @openapi
 * /v1/{networkId}/verified-accounts:
 *   post:
 *     tags: [verified-accounts]
 *     summary: Verify an account component
 *     description: >
 *       Verifies an account component against its on-chain account on the given
 *       network and records it in the registry when it matches.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountId, files]
 *             properties:
 *               accountId:
 *                 type: string
 *                 description: On-chain account identifier to verify against.
 *               files:
 *                 type: object
 *                 description: >
 *                   Map of project-relative file paths to their UTF-8 contents.
 *                   Must contain a `Cargo.toml` and a `miden-project.toml` at the
 *                   project root (or under `entrypoint` when set).
 *                 additionalProperties:
 *                   type: string
 *               entrypoint:
 *                 type: string
 *                 description: >
 *                   Optional subdirectory containing the project to compile.
 *                   When set, `Cargo.toml` and `miden-project.toml` are read from
 *                   `<entrypoint>/`. Defaults to the project root (`.`).
 *               source:
 *                 type: string
 *                 description: >
 *                   Optional identifier of the client that originated the
 *                   verification request (e.g. `miden-verify`, `web-verifier`).
 *                   Recorded on the verified account. Defaults to `unknown`.
 *     responses:
 *       "200":
 *         description: Verification result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified:
 *                   type: boolean
 *       "400":
 *         description: >
 *           Invalid request (missing `accountId`, `files`, `Cargo.toml` or
 *           `miden-project.toml`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "500":
 *         description: Verification failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.post("/:networkId/verified-accounts", async (req, res) => {
  try {
    const {
      accountId,
      files,
      entrypoint = ".",
      source,
    } = req.body as VerifyAccountRequestBody;
    if (!accountId) {
      res.status(400).json({ error: "missing accountId" });
      return;
    }
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
    const verified = await verifyAccountComponent({
      networkId: req.params.networkId,
      accountId,
      files,
      entrypoint,
      source: typeof source === "string" ? source : "unknown",
    });
    res.json({ verified });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "verification failed";
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /v1/{networkId}/verified-accounts/{accountId}:
 *   get:
 *     tags: [verified-accounts]
 *     summary: Get a verified account
 *     description: Returns the verified account record for the given network and account id.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`).
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: On-chain account identifier.
 *     responses:
 *       "200":
 *         description: The verified account record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 source:
 *                   type: string
 *                   description: >
 *                     Identifier of the client that originated the verification
 *                     request. Defaults to `unknown`.
 *       "404":
 *         description: No verified account found for the given parameters.
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
router.get("/:networkId/verified-accounts/:accountId", async (req, res) => {
  try {
    const { networkId, accountId } = req.params;
    const verifiedAccount = await getVerifiedAccount({
      networkId,
      accountId,
    });
    if (!verifiedAccount) {
      res.status(404).json({ error: "verified account not found" });
      return;
    }
    res.json(verifiedAccount);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error
        ? error.message
        : "verified account retrieval failed";
    res.status(500).json({ error: message });
  }
});

export default router;
