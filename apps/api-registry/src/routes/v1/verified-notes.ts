import { join } from "node:path";
import { Router } from "express";
import { getVerifiedNote } from "@/db/verified-notes.js";
import { verifyNote } from "@/lib/verify-note.js";

const router: Router = Router();

type VerifyNoteRequestBody = {
  noteId?: string;
  files?: Record<string, string>;
  entrypoint?: string;
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
 *         description: Network identifier (e.g. `mtst`, `mdev`).
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
 *                   project root (or under `entrypoint` when set).
 *                 additionalProperties:
 *                   type: string
 *               entrypoint:
 *                 type: string
 *                 description: >
 *                   Optional subdirectory containing the project to compile.
 *                   When set, `Cargo.toml` and `miden-project.toml` are read from
 *                   `<entrypoint>/`. Defaults to the project root (`.`).
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
 *           Invalid request (missing `noteId`, `files`, `Cargo.toml` or
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
router.post("/:networkId/verified-notes", async (req, res) => {
  try {
    const {
      noteId,
      files,
      entrypoint = ".",
    } = req.body as VerifyNoteRequestBody;
    if (!noteId) {
      res.status(400).json({ error: "missing noteId" });
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
    const verified = await verifyNote({
      networkId: req.params.networkId,
      noteId,
      files,
      entrypoint,
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
 * /v1/{networkId}/verified-notes/{noteId}:
 *   get:
 *     tags: [verified-notes]
 *     summary: Get a verified note
 *     description: Returns the verified note record for the given network and note id.
 *     parameters:
 *       - in: path
 *         name: networkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Network identifier (e.g. `mtst`, `mdev`).
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *         description: On-chain note identifier.
 *     responses:
 *       "200":
 *         description: The verified note record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       "404":
 *         description: No verified note found for the given parameters.
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
router.get("/:networkId/verified-notes/:noteId", async (req, res) => {
  try {
    const { networkId, noteId } = req.params;
    const verifiedNote = await getVerifiedNote({
      networkId,
      noteId,
    });
    if (!verifiedNote) {
      res.status(404).json({ error: "verified note not found" });
      return;
    }
    res.json(verifiedNote);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "verified note retrieval failed";
    res.status(500).json({ error: message });
  }
});

export default router;
