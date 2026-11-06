import { Router } from "express";
import { openProject } from "miden-source-code-verification-utils/project";
import { getApiCompile } from "../../lib/api-compile.ts";
import { parseRoot } from "../../lib/roots.ts";
import {
  findVerifiedRecord,
  findVerifiedRecordByRoot,
} from "../../lib/verified-record.ts";
import { verifyResource } from "../../lib/verify-resource.ts";
import { getMaspStore } from "../../storage/masp-store.ts";

const router: Router = Router();

type VerifyAccountRequestBody = {
  accountId?: string;
  files?: unknown;
  entrypoint?: unknown;
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
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
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
 *                   project root (or under `entrypoint` when set). Include the
 *                   project's `Cargo.lock` to build with its pinned dependency
 *                   versions. Without one, the latest compatible versions are
 *                   resolved, and the lockfile they produce is stored with the
 *                   package.
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
 *                   Recorded on the verified account component. Defaults to
 *                   `unknown`.
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
 *           Invalid request: a body that isn't valid JSON; a missing `accountId`
 *           or `files`; a file path that isn't project-relative (`..`, a
 *           leading `/`), or a file whose content isn't a string; an
 *           `entrypoint` that isn't a relative directory; no `Cargo.toml` or
 *           `miden-project.toml` at the entrypoint; a `Cargo.toml` that isn't
 *           valid TOML or has no `[package]` (a workspace root). Also a
 *           project the compilation service couldn't build, or an account it
 *           couldn't find on `networkId`, with its message as the error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "409":
 *         description: >
 *           The account's code root on `networkId` is already verified by this
 *           very package: nothing to record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "413":
 *         description: The request body is larger than 1 MB.
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
 *       "502":
 *         $ref: '#/components/responses/CompilerUnavailable'
 *       "503":
 *         $ref: '#/components/responses/CompilerUnavailable'
 *       "504":
 *         $ref: '#/components/responses/CompilerUnavailable'
 */
router.post("/:networkId/verified-accounts", async (req, res) => {
  const { accountId, files, entrypoint, source } =
    req.body as VerifyAccountRequestBody;
  if (!accountId) {
    res.status(400).json({ error: "missing accountId" });
    return;
  }
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  const verified = await verifyResource({
    networkId: req.params.networkId,
    resource: { kind: "account", accountId },
    project: opened.project,
    source: typeof source === "string" ? source : "unknown",
    maspStore: getMaspStore(req),
    apiCompile: getApiCompile(req),
  });
  res.json({ verified });
});

/**
 * @openapi
 * /v1/{networkId}/verified-accounts/code/{code}:
 *   get:
 *     tags: [verified-accounts]
 *     summary: Get a verified account by code
 *     description: >
 *       Returns the verified account record keyed on the given network and
 *       account code root. Records are stored per `(networkId, code)` pair —
 *       not per account — so this is the registry's canonical account lookup:
 *       unlike `/v1/{networkId}/verified-accounts/{accountId}` it is a pure
 *       database read and never fetches the account on-chain. Prefer it
 *       whenever the caller already knows the code.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[0-9a-fA-F]{64}$'
 *         description: >
 *           Account code root — `0x` followed by 64 hex characters (32 bytes),
 *           matched case-insensitively. Note this is the account's *code*, not
 *           its (shorter) on-chain id.
 *     responses:
 *       "200":
 *         description: >
 *           The verified account record for `networkId` and `code`, including
 *           every verified account component and its compiled package. No
 *           account took part in the lookup, so there is no `accountId` to echo
 *           back.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 networkId:
 *                   type: string
 *                   description: The network the record is keyed on.
 *                 code:
 *                   type: string
 *                   description: The account code root the record is keyed on (32-byte hex).
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 verifiedAccountComponents:
 *                   type: array
 *                   description: >
 *                     The verified account components whose packages together
 *                     make up the account's code.
 *                   items:
 *                     $ref: '#/components/schemas/VerifiedAccountComponent'
 *       "400":
 *         description: Invalid `code` (not a 32-byte hex root).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "404":
 *         description: No verified account found for the given network and code.
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
router.get("/:networkId/verified-accounts/code/:code", async (req, res) => {
  const { networkId } = req.params;
  const code = parseRoot(req.params.code);
  if (!code) {
    res.status(400).json({ error: "invalid code" });
    return;
  }
  res.json(
    await findVerifiedRecordByRoot({ networkId, kind: "account", root: code }),
  );
});

/**
 * @openapi
 * /v1/{networkId}/verified-accounts/{accountId}:
 *   get:
 *     tags: [verified-accounts]
 *     summary: Get a verified account by on-chain id
 *     description: >
 *       Resolves the account's code root on the given network, then returns the
 *       record keyed on it — the same one
 *       `/v1/{networkId}/verified-accounts/code/{code}` serves, plus the
 *       queried `accountId` echoed back. Resolving costs a call to the internal
 *       compilation API, so callers that already know the code should use the
 *       code-keyed endpoint instead.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         description: On-chain account identifier.
 *     responses:
 *       "200":
 *         description: >
 *           The verified account record whose code matches the on-chain account
 *           at `accountId` on `networkId`, including every verified account
 *           component and its compiled package. The match is by account code,
 *           so the record may have originated from a different account on the
 *           same network sharing the same code. The queried `accountId` is
 *           echoed back.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 networkId:
 *                   type: string
 *                   description: The network the record is keyed on.
 *                 code:
 *                   type: string
 *                   description: The account code root the record is keyed on (32-byte hex).
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 verifiedAccountComponents:
 *                   type: array
 *                   description: >
 *                     The verified account components whose packages together
 *                     make up the account's code.
 *                   items:
 *                     $ref: '#/components/schemas/VerifiedAccountComponent'
 *                 accountId:
 *                   type: string
 *                   description: The queried on-chain account identifier, echoed back.
 *                 standardAccountComponents:
 *                   type: array
 *                   description: >
 *                     The standard components (e.g. `BasicWallet`,
 *                     `AuthSingleSig`) detected in the account's code, each with
 *                     the procedure roots it accounts for. Only this id-keyed
 *                     endpoint returns it, as it comes from the on-chain lookup.
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       procedures:
 *                         type: array
 *                         items:
 *                           type: string
 *                 procedures:
 *                   type: array
 *                   description: >
 *                     Every procedure root (32-byte hex) in the account's code.
 *                     Only this id-keyed endpoint returns it.
 *                   items:
 *                     type: string
 *       "404":
 *         description: >
 *           No verified account found for the given parameters, or no account
 *           with this id on `networkId`.
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
 *       "502":
 *         $ref: '#/components/responses/CompilerUnavailable'
 *       "503":
 *         $ref: '#/components/responses/CompilerUnavailable'
 *       "504":
 *         $ref: '#/components/responses/CompilerUnavailable'
 */
router.get("/:networkId/verified-accounts/:accountId", async (req, res) => {
  const { networkId, accountId } = req.params;
  res.json(
    await findVerifiedRecord({
      networkId,
      resource: { kind: "account", accountId },
      apiCompile: getApiCompile(req),
    }),
  );
});

export default router;
