import { Router } from "express";
import type { ImportedResource } from "miden-source-code-verification-utils/api-compile";
import { IMPORT_CONCURRENCY, IMPORT_QUEUE_SIZE } from "../lib/constants.ts";
import { midenImport } from "../lib/helper-tools.ts";
import { createLimiter } from "../lib/limiter.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

const limit = createLimiter({
  concurrency: IMPORT_CONCURRENCY,
  queueSize: IMPORT_QUEUE_SIZE,
});

router.get("/:networkId/import/:resourceId", async (req, res) => {
  const { networkId, resourceId } = req.params;
  // Throws `BusyError` (a 503) once the queue is full.
  const run = await limit(
    () => midenImport({ networkId, resourceId }),
    abortOnClose(res),
  );
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
