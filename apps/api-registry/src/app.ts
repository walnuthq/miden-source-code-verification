import cors from "cors";
import express, { type Express } from "express";
import { type Database, dbScope } from "@/db/context.js";
import { ALLOWED_ORIGINS, API_COMPILE_URL, PORT } from "@/lib/constants.js";
import verifiedAccountsRouterV1 from "@/routes/v1/verified-accounts.js";
import verifiedNotesRouterV1 from "@/routes/v1/verified-notes.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     PackageType:
 *       type: string
 *       description: The kind of package a verified resource was compiled to.
 *       enum: [library, account-component, authentication-component, note, tx-script]
 *     ProcedureSignature:
 *       type: object
 *       nullable: true
 *       description: Type signature of an exported procedure (null when unavailable).
 *       properties:
 *         abi:
 *           type: integer
 *           description: >
 *             Calling convention of the procedure (Miden `CallConv` discriminant):
 *             `0` = fast, `1` = C, `2` = wasm, `3` = component-model.
 *         params:
 *           type: array
 *           items:
 *             type: string
 *         results:
 *           type: array
 *           items:
 *             type: string
 *     ProcedureExport:
 *       type: object
 *       description: A procedure exported by the package manifest.
 *       properties:
 *         Procedure:
 *           type: object
 *           properties:
 *             path:
 *               type: string
 *               description: Fully-qualified path of the exported procedure.
 *             digest:
 *               type: string
 *               description: MAST root of the procedure (32-byte hex).
 *             signature:
 *               $ref: '#/components/schemas/ProcedureSignature'
 *             attributes:
 *               type: object
 *               properties:
 *                 attrs:
 *                   type: array
 *                   items:
 *                     type: string
 *     PackageDependency:
 *       type: object
 *       description: A package the manifest depends on.
 *       properties:
 *         name:
 *           type: string
 *         kind:
 *           $ref: '#/components/schemas/PackageType'
 *         version:
 *           type: string
 *         digest:
 *           type: string
 *           description: Digest of the dependency (32-byte hex).
 *     Manifest:
 *       type: object
 *       description: The compiled package manifest — its exports and dependencies.
 *       properties:
 *         exports:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProcedureExport'
 *         dependencies:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PackageDependency'
 *     Package:
 *       type: object
 *       description: A compiled Rust source package recorded in the registry.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *           description: Package name from its `Cargo.toml`.
 *         type:
 *           $ref: '#/components/schemas/PackageType'
 *         files:
 *           type: object
 *           description: >
 *             Map of project-relative file paths to their UTF-8 source contents
 *             (the exact inputs that were compiled).
 *           additionalProperties:
 *             type: string
 *         masp:
 *           type: string
 *           description: Base64-encoded compiled Miden package (`.masp`).
 *         digest:
 *           type: string
 *           description: Package digest (32-byte hex).
 *         manifest:
 *           $ref: '#/components/schemas/Manifest'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     VerifiedAccountComponent:
 *       type: object
 *       description: >
 *         Join row linking a verified account code root to one of the component
 *         packages that make up its code, along with the package itself.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         verifiedAccountId:
 *           type: string
 *           format: uuid
 *         packageId:
 *           type: string
 *           format: uuid
 *         packageDigest:
 *           type: string
 *           description: Digest of the component package (32-byte hex).
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         package:
 *           $ref: '#/components/schemas/Package'
 */

type CreateAppOptions = {
  /**
   * When provided, every request runs inside its own database connection built
   * by this factory and disposed when the response closes. Deployments that
   * cannot share a connection across requests (e.g. Cloudflare Workers) supply
   * this; the default Node server omits it and keeps the shared singleton.
   */
  requestDbFactory?: () => Database;
};

export const createApp = ({
  requestDbFactory,
}: CreateAppOptions = {}): Express => {
  const app = express();

  // Must run before the routers so the request-scoped db is set for the whole
  // handler chain. No-op unless a factory is supplied.
  if (requestDbFactory) {
    app.use((_req, res, next) => {
      const db = requestDbFactory();
      res.once("close", () => {
        void db.$client.end().catch(() => {});
      });
      dbScope.run(db, next);
    });
  }

  const allowedOrigins = ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(
    cors({
      origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      timestamp: Date.now(),
      env: { PORT, ALLOWED_ORIGINS, API_COMPILE_URL },
    });
  });

  app.use("/v1", verifiedAccountsRouterV1);
  app.use("/v1", verifiedNotesRouterV1);

  return app;
};
