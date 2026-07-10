import { Router } from "express";
import { midenImport } from "@/lib/miden-import.js";

const router = Router();

router.get("/:networkId/import/:resourceId", async (req, res) => {
  try {
    const { networkId, resourceId } = req.params;
    const { stdout, error } = await midenImport({ networkId, resourceId });
    if (error || !stdout) {
      res.status(404).json({ error: error ?? "resource not found" });
      return;
    }
    res.json(JSON.parse(stdout));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Import failed";
    res.status(500).json({ error: message });
  }
});

export default router;
