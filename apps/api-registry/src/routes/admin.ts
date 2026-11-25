import { createHash, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import { notFound } from "miden-source-code-verification-utils/http-errors";
import { cleanupPlaygroundResources } from "../lib/cleanup-playground.ts";
import { ADMIN_TOKEN } from "../lib/constants.ts";
import { getMaspStore } from "../storage/masp-store.ts";

// Operator routes, left out of the OpenAPI docs: the cleanup of the
// playground's verifications. They run here because the Worker is what holds
// the R2 and database bindings.
const router: Router = Router();

// Hashed first so both sides have the same length, as `timingSafeEqual` needs.
const digest = (value: string) => createHash("sha256").update(value).digest();

const requireAdmin: RequestHandler = (req, res, next) => {
  if (!ADMIN_TOKEN) {
    notFound(req, res, next);
    return;
  }
  const token = /^Bearer (.+)$/.exec(req.get("Authorization") ?? "")?.[1];
  if (!token || !timingSafeEqual(digest(token), digest(ADMIN_TOKEN))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

router.use("/admin", requireAdmin);

// Deletes the playground's verifications older than a day, and the packages
// and artifacts only they used.
router.post("/admin/playground/cleanup", async (req, res) => {
  res.json(await cleanupPlaygroundResources({ maspStore: getMaspStore(req) }));
});

export default router;
