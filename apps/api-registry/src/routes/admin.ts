import { createHash, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import type { ReadOnlyProcedures } from "miden-source-code-verification-utils/manifest";
import {
  getPackage,
  getPackagesWithoutDebugBuild,
  getPackagesWithoutReadOnly,
  updatePackage,
} from "../db/packages.ts";
import {
  ApiCompileError,
  fetchApiCompile,
  sendApiCompileUnavailable,
} from "../lib/api-compile.ts";
import { cleanupPlaygroundResources } from "../lib/cleanup-playground.ts";
import { ADMIN_TOKEN } from "../lib/constants.ts";
import { type DebugBuild, storeDebugBuild } from "../lib/debug-build.ts";
import { notFound } from "../lib/errors.ts";
import { inferEntrypoint } from "../lib/infer-entrypoint.ts";
import { parseRoot } from "../lib/roots.ts";
import { getMaspStore } from "../storage/masp-store.ts";

// Operator routes, left out of the OpenAPI docs: the backfills of debug builds
// and of procedures' read-only flags for packages stored before the registry
// kept them (`scripts/backfill-debug-packages.ts` and
// `scripts/backfill-read-only.ts` drive them) and the cleanup of the
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

// The packages the backfill still has to build.
router.get("/admin/debug-builds/pending", async (_req, res) => {
  try {
    res.json(await getPackagesWithoutDebugBuild());
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "listing failed";
    res.status(500).json({ error: message });
  }
});

// Builds and stores the debug build of one stored package. api-compile first
// rebuilds the release build and answers 409 when it no longer has the stored
// commitment (toolchain drift): that package keeps no debug build until it is
// verified again.
router.post("/admin/packages/:commitment/debug-build", async (req, res) => {
  try {
    const commitment = parseRoot(req.params.commitment);
    if (!commitment) {
      res.status(400).json({ error: "invalid package commitment" });
      return;
    }
    const dbPackage = await getPackage(commitment);
    if (!dbPackage) {
      res.status(404).json({ error: "package not found" });
      return;
    }
    if (dbPackage.debugCommitment) {
      res.json({ debugCommitment: dbPackage.debugCommitment });
      return;
    }
    const files = dbPackage.files as Record<string, string>;
    const entrypoint =
      dbPackage.entrypoint ?? inferEntrypoint(files, dbPackage.name);
    if (!entrypoint) {
      res.status(422).json({ error: "ambiguous entrypoint" });
      return;
    }
    const { debug } = await fetchApiCompile<{ debug?: DebugBuild }>(
      "/compile-debug",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files,
          entrypoint,
          expectedCommitment: commitment,
        }),
      },
    );
    if (!debug || "error" in debug) {
      res
        .status(422)
        .json({ error: debug?.error ?? "api-compile returned no debug build" });
      return;
    }
    await storeDebugBuild({
      maspStore: getMaspStore(req),
      packageId: dbPackage.id,
      commitment,
      debug,
    });
    if (!dbPackage.entrypoint) {
      // The release build reproduced from it, so it is the right one.
      await updatePackage(dbPackage.id, { entrypoint });
    }
    res.json({ debugCommitment: debug.commitment });
  } catch (error) {
    console.error(error);
    if (sendApiCompileUnavailable(res, error)) {
      return;
    }
    // 409 (toolchain drift) and 400 (the sources no longer build).
    if (error instanceof ApiCompileError && error.status < 500) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message =
      error instanceof Error ? error.message : "debug build failed";
    res.status(500).json({ error: message });
  }
});

// The packages the read-only backfill still has to read.
router.get("/admin/read-only/pending", async (_req, res) => {
  try {
    res.json(await getPackagesWithoutReadOnly());
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "listing failed";
    res.status(500).json({ error: message });
  }
});

// Reads which procedures of one stored package are read-only and records it.
// api-compile reads them from the stored `.masp`, so nothing is rebuilt and
// the toolchain's drift doesn't matter, only that it still reads the format.
// It answers the package's commitment too, which must be the stored one.
router.post("/admin/packages/:commitment/read-only", async (req, res) => {
  try {
    const commitment = parseRoot(req.params.commitment);
    if (!commitment) {
      res.status(400).json({ error: "invalid package commitment" });
      return;
    }
    const dbPackage = await getPackage(commitment);
    if (!dbPackage) {
      res.status(404).json({ error: "package not found" });
      return;
    }
    if (dbPackage.readOnly) {
      res.json({ readOnly: dbPackage.readOnly });
      return;
    }
    const masp = await getMaspStore(req).get(commitment);
    if (!masp) {
      res.status(404).json({ error: "package masp not found" });
      return;
    }
    const metadata = await fetchApiCompile<{
      commitment: string;
      readOnly: ReadOnlyProcedures;
    }>("/package-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: masp,
    });
    if (metadata.commitment.toLowerCase() !== commitment.toLowerCase()) {
      res.status(409).json({
        error: `stored masp has commitment ${metadata.commitment}`,
      });
      return;
    }
    await updatePackage(dbPackage.id, { readOnly: metadata.readOnly });
    res.json({ readOnly: metadata.readOnly });
  } catch (error) {
    console.error(error);
    if (sendApiCompileUnavailable(res, error)) {
      return;
    }
    // 400: api-compile can't read the stored package.
    if (error instanceof ApiCompileError && error.status < 500) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message =
      error instanceof Error ? error.message : "reading read-only failed";
    res.status(500).json({ error: message });
  }
});

// Deletes the playground's verifications older than a day, and the packages
// and artifacts only they used.
router.post("/admin/playground/cleanup", async (req, res) => {
  try {
    res.json(
      await cleanupPlaygroundResources({ maspStore: getMaspStore(req) }),
    );
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "cleanup failed";
    res.status(500).json({ error: message });
  }
});

export default router;
