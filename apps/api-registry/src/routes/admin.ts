import { createHash, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import { notFound } from "miden-source-code-verification-utils/http-errors";
import { inferEntrypoint } from "miden-source-code-verification-utils/project";
import {
  getPackage,
  getPackagesWithoutDebugBuild,
  getPackagesWithoutSchemas,
  packageSchemas,
  updatePackage,
} from "../db/packages.ts";
import { getApiCompile } from "../lib/api-compile.ts";
import { cleanupPlaygroundResources } from "../lib/cleanup-playground.ts";
import { ADMIN_TOKEN } from "../lib/constants.ts";
import { storeDebugBuild } from "../lib/debug-build.ts";
import { parseRoot } from "../lib/roots.ts";
import { getMaspStore } from "../storage/masp-store.ts";

// Operator routes, left out of the OpenAPI docs: the backfills of debug builds
// and of storage schemas for packages stored before the registry kept them
// (`scripts/backfill-debug-packages.ts` and `scripts/backfill-schemas.ts`
// drive them) and the cleanup of the
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
  res.json(await getPackagesWithoutDebugBuild());
});

// Builds and stores the debug build of one stored package. api-compile first
// rebuilds the release build and answers 409 when it no longer has the stored
// commitment (toolchain drift), or 400 when the sources no longer build; both
// pass through, and that package keeps no debug build until it is verified
// again.
router.post("/admin/packages/:commitment/debug-build", async (req, res) => {
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
  const { files } = dbPackage;
  const entrypoint =
    dbPackage.entrypoint ?? inferEntrypoint(files, dbPackage.name);
  if (!entrypoint) {
    res.status(422).json({ error: "ambiguous entrypoint" });
    return;
  }
  const { debug } = await getApiCompile(req).compileDebug({
    files,
    entrypoint,
    expectedCommitment: commitment,
  });
  if ("error" in debug) {
    res.status(422).json({ error: debug.error });
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
});

// The packages the schemas backfill still has to read.
router.get("/admin/schemas/pending", async (_req, res) => {
  res.json(await getPackagesWithoutSchemas());
});

// Reads the storage schemas of one stored package and records them.
// api-compile reads them from the stored `.masp`, so nothing is rebuilt and
// the toolchain's drift doesn't matter, only that it still reads the format.
// It answers the package's commitment too, which must be the stored one. A
// 400 from api-compile (it can't read the package) passes through.
router.post("/admin/packages/:commitment/schemas", async (req, res) => {
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
  if (dbPackage.schemas) {
    res.json({ schemas: dbPackage.schemas });
    return;
  }
  const masp = await getMaspStore(req).get(commitment);
  if (!masp) {
    res.status(404).json({ error: "package masp not found" });
    return;
  }
  const metadata = await getApiCompile(req).packageMetadata(masp);
  if (metadata.commitment.toLowerCase() !== commitment.toLowerCase()) {
    res
      .status(409)
      .json({ error: `stored masp has commitment ${metadata.commitment}` });
    return;
  }
  const schemas = packageSchemas(metadata);
  await updatePackage(dbPackage.id, { schemas });
  res.json({ schemas });
});

// Deletes the playground's verifications older than a day, and the packages
// and artifacts only they used.
router.post("/admin/playground/cleanup", async (req, res) => {
  res.json(await cleanupPlaygroundResources({ maspStore: getMaspStore(req) }));
});

export default router;
