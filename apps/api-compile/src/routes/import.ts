import { Router } from "express";
import { MIDEN_TOOL_REJECTED_EXIT_CODE } from "../lib/constants.ts";
import { midenImport } from "../lib/miden-import.ts";

const router = Router();

router.get("/:networkId/import/:resourceId", async (req, res) => {
  const { networkId, resourceId } = req.params;
  const result = await midenImport({ networkId, resourceId });
  if (result.error !== undefined) {
    // Only a resource the tool found doesn't exist is a 404: callers read it
    // as "not on-chain". Anything else (the node, the store, a timeout) may
    // pass on a retry.
    const status =
      result.exitCode === MIDEN_TOOL_REJECTED_EXIT_CODE ? 404 : 502;
    res.status(status).json({ error: result.error });
    return;
  }
  res.json(JSON.parse(result.stdout));
});

export default router;
