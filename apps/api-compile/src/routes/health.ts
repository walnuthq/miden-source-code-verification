import { Router } from "express";
import { cargoMidenVersion } from "../lib/cargo-miden.ts";
import {
  ALLOWED_ORIGINS,
  CARGO_TARGET_DIR,
  MIDEN_CLIENT_CACHE_DIR,
  PORT,
} from "../lib/constants.ts";

const router = Router();

// `/` is the health probe, so it must not run cargo on every request: a stuck
// or starved toolchain would make a healthy server look down. Resolve the
// version once, at startup.
const cargoMidenVersionPromise = cargoMidenVersion().catch((error) => {
  console.error(error);
  return null;
});

router.get("/", async (_req, res) => {
  res.json({
    timestamp: Date.now(),
    env: {
      PORT,
      ALLOWED_ORIGINS,
      CARGO_TARGET_DIR,
      MIDEN_CLIENT_CACHE_DIR,
    },
    cargoMidenVersion: await cargoMidenVersionPromise,
  });
});

export default router;
