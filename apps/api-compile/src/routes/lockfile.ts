import { readFile } from "node:fs/promises";
import { Router } from "express";
import { WARM_CARGO_LOCK } from "../lib/constants.ts";

const router = Router();

// The warm cache's Cargo.lock, as text. A client lockfile that pins the same
// registry crates builds offline in seconds; one that pins other versions
// downloads and rebuilds them (or, with `warmLockfile`, is re-resolved).
router.get("/lockfile", async (_req, res) => {
  try {
    const cargoLock = await readFile(WARM_CARGO_LOCK, "utf-8");
    res.type("text/plain").send(cargoLock);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "warm lockfile unavailable" });
  }
});

export default router;
