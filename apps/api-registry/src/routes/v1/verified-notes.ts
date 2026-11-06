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

type VerifyNoteRequestBody = {
  noteId?: string;
  files?: unknown;
  entrypoint?: unknown;
  source?: string;
};

/**
 * @openapi
 * /v1/{networkId}/verified-notes:
 *   post:
 *     tags: [verified-notes]
 *     summary: Verify a note
 *     description: >
 *       Verifies a note against its on-chain note on the given network and
 *       records it in the registry when it matches.
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
 *             required: [noteId, files]
 *             properties:
 *               noteId:
 *                 type: string
 *                 description: On-chain note identifier to verify against.
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
 *                   Recorded on the verified note. Defaults to `unknown`.
 *     responses:
 *       "200":
 *         description: Verification result.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerificationResponse'
 *       "400":
 *         description: >
 *           Invalid request: a body that isn't valid JSON; a missing `noteId`
 *           or `files`; a file path that isn't project-relative (`..`, a
 *           leading `/`), or a file whose content isn't a string; an
 *           `entrypoint` that isn't a relative directory; no `Cargo.toml` or
 *           `miden-project.toml` at the entrypoint; a `Cargo.toml` that isn't
 *           valid TOML or has no `[package]` (a workspace root). Also a
 *           project the compilation service couldn't build, or a note it
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
 *           The note's script root on `networkId` is already verified: nothing
 *           to record.
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
router.post("/:networkId/verified-notes", async (req, res) => {
  const { noteId, files, entrypoint, source } =
    req.body as VerifyNoteRequestBody;
  if (!noteId) {
    res.status(400).json({ error: "missing noteId" });
    return;
  }
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  const verified = await verifyResource({
    networkId: req.params.networkId,
    resource: { kind: "note", noteId },
    project: opened.project,
    source: typeof source === "string" ? source : "unknown",
    maspStore: getMaspStore(req),
    apiCompile: getApiCompile(req),
  });
  res.json({ verified });
});

/**
 * @openapi
 * /v1/{networkId}/verified-notes/script/{script}:
 *   get:
 *     tags: [verified-notes]
 *     summary: Get a verified note by script
 *     description: >
 *       Returns the verified note record keyed on the given network and note
 *       script root. Records are stored per `(networkId, script)` pair — not
 *       per note — so this is the registry's canonical note lookup: unlike
 *       `/v1/{networkId}/verified-notes/{noteId}` it is a pure database read
 *       and never fetches the note on-chain. Prefer it whenever the caller
 *       already knows the script.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
 *       - in: path
 *         name: script
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^0x[0-9a-fA-F]{64}$'
 *         description: >
 *           Note script root — `0x` followed by 64 hex characters (32 bytes),
 *           matched case-insensitively. Note ids share that width, so passing
 *           one here returns `404`, not `400`.
 *     responses:
 *       "200":
 *         description: >
 *           The verified note record for `networkId` and `script`, including
 *           the compiled package it was verified against. No note took part in
 *           the lookup, so there is no `noteId` to echo back.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifiedNote'
 *       "400":
 *         description: Invalid `script` (not a 32-byte hex root).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       "404":
 *         description: No verified note found for the given network and script.
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
router.get("/:networkId/verified-notes/script/:script", async (req, res) => {
  const { networkId } = req.params;
  const script = parseRoot(req.params.script);
  if (!script) {
    res.status(400).json({ error: "invalid script" });
    return;
  }
  res.json(
    await findVerifiedRecordByRoot({ networkId, kind: "note", root: script }),
  );
});

/**
 * @openapi
 * /v1/{networkId}/verified-notes/{noteId}:
 *   get:
 *     tags: [verified-notes]
 *     summary: Get a verified note by on-chain id
 *     description: >
 *       Resolves the note's script root on the given network, then returns the
 *       record keyed on it — the same one
 *       `/v1/{networkId}/verified-notes/script/{script}` serves, plus the
 *       queried `noteId` echoed back. Resolving costs a call to the internal
 *       compilation API, so callers that already know the script should use the
 *       script-keyed endpoint instead.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`, `mm`).
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *         description: On-chain note identifier.
 *     responses:
 *       "200":
 *         description: >
 *           The verified note record whose script matches the on-chain note at
 *           `noteId` on `networkId`, including the compiled package it was
 *           verified against. The match is by note script, so the record may
 *           have originated from a different note on the same network sharing
 *           the same script. The queried `noteId` is echoed back.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifiedNoteById'
 *       "404":
 *         description: >
 *           No verified note found for the given parameters, or no note
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
router.get("/:networkId/verified-notes/:noteId", async (req, res) => {
  const { networkId, noteId } = req.params;
  res.json(
    await findVerifiedRecord({
      networkId,
      resource: { kind: "note", noteId },
      apiCompile: getApiCompile(req),
    }),
  );
});

export default router;
