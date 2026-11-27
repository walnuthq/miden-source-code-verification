import { createHash, timingSafeEqual } from "node:crypto";

import { type RequestHandler, Router } from "express";
import { notFound } from "miden-source-code-verification-utils/http-errors";

import { cleanupPlaygroundResources } from "../lib/cleanup-playground.ts";
import { ADMIN_TOKEN } from "../lib/constants.ts";
import { deleteRustPackages, listRustPackages } from "../lib/rust-packages.ts";
import { getMaspStore } from "../storage/masp-store.ts";

// Operator routes, left out of the OpenAPI docs: the cleanup of the
// playground's verifications, and the deletion of the Rust-built packages.
// They run here because the Worker is what holds
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

// The deletion's dry run: the Rust packages, and per network the verified
// accounts and notes and the files that go with them. Deletes nothing.
router.get("/admin/rust-packages", async (_req, res) => {
  res.json(await listRustPackages());
});

const DEFAULT_DELETE_LIMIT = 50;
const MAX_DELETE_LIMIT = 200;

// Deletes the next `limit` Rust packages (50 by default, at most 200) and what
// points at them, then answers what it deleted and how many are left.
router.post("/admin/rust-packages/delete", async (req, res) => {
  const { limit = DEFAULT_DELETE_LIMIT } = (req.body ?? {}) as { limit?: unknown };
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_DELETE_LIMIT) {
    res.status(400).json({ error: `limit must be an integer from 1 to ${MAX_DELETE_LIMIT}` });
    return;
  }
  res.json(await deleteRustPackages({ maspStore: getMaspStore(req), limit: limit as number }));
});

export default router;
