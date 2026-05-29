import { Router } from "express";
import { verifyNote } from "@/lib/verify-note.js";
import { getVerifiedNote } from "@/db/verified-notes.js";

const router = Router();

type VerifyNoteRequestBody = {
  noteId?: string;
  files?: Record<string, string>;
  entrypoint?: string;
};

router.post("/:networkId/verified-notes", async (req, res) => {
  const { noteId, files, entrypoint } = req.body as VerifyNoteRequestBody;
  if (!noteId) {
    res.status(400).json({ error: "missing noteId" });
    return;
  }
  if (!files || typeof files !== "object") {
    res.status(400).json({ error: "missing files" });
    return;
  }
  const cargoTomlPath = entrypoint ? `${entrypoint}/Cargo.toml` : "Cargo.toml";
  if (!files[cargoTomlPath]) {
    res.status(400).json({ error: "missing Cargo.toml" });
    return;
  }
  try {
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

router.get("/:networkId/verified-notes/:noteId", async (req, res) => {
  const { networkId, noteId } = req.params;
  try {
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
