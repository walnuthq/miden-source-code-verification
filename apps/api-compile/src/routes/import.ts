import { Router } from "express";
import type { ImportedResource } from "miden-source-code-verification-utils/api-compile";
import { midenImport } from "../lib/helper-tools.ts";

const router = Router();

router.get("/:networkId/import/:resourceId", async (req, res) => {
  const { networkId, resourceId } = req.params;
  const run = await midenImport({ networkId, resourceId });
  if ("error" in run) {
    // Only a resource the tool found doesn't exist is a 404: callers read it
    // as "not on-chain". Anything else (the node, the store, a timeout, a
    // broken run) may pass on a retry.
    res.status(run.rejected ? 404 : 502).json({ error: run.error });
    return;
  }
  // What `miden-import` prints is the answer, as is.
  res.json(run.output satisfies ImportedResource);
});

export default router;
