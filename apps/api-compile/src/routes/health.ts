import { Router } from "express";

import { ALLOWED_ORIGINS, MIDEN_CLIENT_CACHE_DIR, PORT } from "../lib/constants.ts";

const router = Router();

// `/` is the health probe: it answers at once and runs no tool.
router.get("/", (_req, res) => {
  res.json({
    timestamp: Date.now(),
    env: {
      PORT,
      ALLOWED_ORIGINS,
      MIDEN_CLIENT_CACHE_DIR,
    },
  });
});

export default router;
