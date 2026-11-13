import cors from "cors";
import express, { type Express } from "express";
import {
  errorHandler,
  notFound,
} from "miden-source-code-verification-utils/http-errors";
import { type Database, dbScope } from "./db/context.ts";
import { type ApiCompile, createHttpApiCompile } from "./lib/api-compile.ts";
import {
  ALLOWED_ORIGINS,
  API_COMPILE_URL,
  MASP_STORAGE_DIR,
  PORT,
} from "./lib/constants.ts";
import { hideQueryErrors } from "./lib/query-errors.ts";
import adminRouter from "./routes/admin.ts";
import packagesRouterV1 from "./routes/v1/packages.ts";
import verifiedAccountsRouterV1 from "./routes/v1/verified-accounts.ts";
import verifiedNotesRouterV1 from "./routes/v1/verified-notes.ts";
import { createFsMaspStore, type MaspStore } from "./storage/masp-store.ts";

/**
 * @openapi
 * components:
 *   schemas:
 *     PackageType:
 *       type: string
 *       description: >
 *         The kind of a package (Miden `TargetType`, by its canonical name): the
 *         kind a verified resource was compiled to, and the kind of each
 *         dependency in a manifest. An authentication component is an
 *         `account-component`.
 *       enum: [library, executable, kernel, account-component, note, transaction-script]
 *     ValueType:
 *       description: >
 *         A Miden type, serialized as the compiler emits it: a string for a
 *         primitive (e.g. `Felt`, `I32`), or an object keyed on the compound
 *         kind (e.g. `{ "Struct": { name, repr, size, fields } }`) whose fields
 *         nest further types.
 *       oneOf:
 *         - type: string
 *         - type: object
 *     ProcedureSignature:
 *       type: [object, "null"]
 *       description: Type signature of an exported procedure (null when unavailable).
 *       properties:
 *         abi:
 *           description: >
 *             Calling convention of the procedure (Miden `CallConv`): its
 *             discriminant for a built-in convention, `0` = fast, `1` = C,
 *             `2` = wasm, `3` = component-model, or `{ "Extern": name }` for one
 *             a language frontend defines.
 *           oneOf:
 *             - type: integer
 *               enum: [0, 1, 2, 3]
 *             - type: object
 *               required: [Extern]
 *               properties:
 *                 Extern:
 *                   type: string
 *         params:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ValueType'
 *         results:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ValueType'
 *     ProcedureExport:
 *       type: object
 *       description: >
 *         An item exported by the package manifest, keyed on its kind: one of
 *         `Procedure`, `Constant` or `Type`. The packages verified so far only
 *         export procedures.
 *       properties:
 *         Procedure:
 *           type: object
 *           properties:
 *             path:
 *               type: string
 *               description: Fully-qualified path of the exported procedure.
 *             node:
 *               type: [integer, "null"]
 *               description: >
 *                 Id of the procedure's root node in the package's MAST, which
 *                 tells apart procedures that compile to the same digest.
 *             source_node:
 *               type: [integer, "null"]
 *               description: Id of the procedure's node in the package's debug info.
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
 *                   description: >
 *                     The procedure's attributes, each keyed on its form:
 *                     `{ "Marker": "account_procedure" }`, or a `List` or
 *                     `KeyValue` for a parameterized one.
 *                   items:
 *                     type: object
 *         Constant:
 *           type: object
 *           description: An exported constant.
 *         Type:
 *           type: object
 *           description: An exported type declaration.
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
 *           description: >
 *             Commitment of the dependency package as resolved at build time
 *             (32-byte hex) — the same value as that package's `commitment`.
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
 *     StorageSlotSchema:
 *       type: object
 *       description: >
 *         One of an account component's storage slots, from the account
 *         component metadata in its package. Types are the schema's names:
 *         `word` and `felt`, or a named type such as
 *         `miden::standards::auth::pub_key`. A composite value slot (one
 *         schema per felt) is reported as a `word` with neither its felts'
 *         types nor its default; a map's default entries aren't reported.
 *       required: [name, type, valueType]
 *       properties:
 *         name:
 *           type: string
 *           description: The slot's full name, e.g. `counter_contract::counter_contract::count_map`.
 *         description:
 *           type: string
 *         type:
 *           type: string
 *           enum: [value, map]
 *         valueType:
 *           type: string
 *         keyType:
 *           type: string
 *           description: A map slot's key type.
 *         defaultValue:
 *           type: string
 *           description: A value slot's default word (32-byte hex), when the schema gives one.
 *     NoteStorageField:
 *       type: object
 *       description: One of a note's storage fields (its inputs), in storage order.
 *       required: [name, type]
 *       properties:
 *         name:
 *           type: string
 *           description: The field's WIT name, e.g. `target-account-id`.
 *         type:
 *           type: string
 *           description: >
 *             Its WIT type name (`felt`, `word`, `account-id`, `u64`, ..., or a
 *             record the note defines, whose own fields aren't reported), or
 *             `record`, `option` or `variant` for a type with no name.
 *         width:
 *           type: integer
 *           description: The felts it takes in the note's storage. Absent when that varies.
 *         description:
 *           type: string
 *     PackageSchemas:
 *       type: object
 *       description: >
 *         A package's storage schemas. A key is absent when the package has no
 *         such schema.
 *       properties:
 *         storage:
 *           type: object
 *           description: An account component's storage slots, in slot order.
 *           required: [slots]
 *           properties:
 *             slots:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StorageSlotSchema'
 *         noteStorage:
 *           type: object
 *           description: A note's storage schema.
 *           required: [name, fields]
 *           properties:
 *             name:
 *               type: string
 *               description: The storage record's WIT name, e.g. `p2id-note`.
 *             fields:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/NoteStorageField'
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
 *             (the exact inputs that were compiled). Includes the `Cargo.lock`
 *             the build used, even when the verification request didn't send
 *             one, so the dependency versions behind `commitment` are recorded.
 *           additionalProperties:
 *             type: string
 *         commitment:
 *           type: string
 *           description: >
 *             Commitment to the package — its code, name, version, kind,
 *             manifest and account component metadata (32-byte hex).
 *             Reproducible: rebuilding the same sources gives the same value.
 *         manifest:
 *           $ref: '#/components/schemas/Manifest'
 *         entrypoint:
 *           type: [string, "null"]
 *           description: >
 *             The project directory within `files` the package was built from
 *             (`.` for the root). Null for packages recorded before it was
 *             stored.
 *         builtWith:
 *           type: [string, "null"]
 *           description: Version of cargo-miden that built the package, when known.
 *         debugCommitment:
 *           type: [string, "null"]
 *           description: >
 *             Commitment of the package's debug build (32-byte hex), served as
 *             `/v1/{networkId}/packages/masp/{commitment}.debug.masp`. Null
 *             when it has none yet.
 *         debugBuiltWith:
 *           type: [string, "null"]
 *           description: Version of cargo-miden that built the debug build, when known.
 *         readOnly:
 *           type: object
 *           description: >
 *             Whether each procedure the package exports is read-only, keyed
 *             by its export path (as in the manifest's exports): `true` when
 *             nothing it can reach changes state, `false` when something can,
 *             `null` when it can't be told (a dynamic call, a direct syscall,
 *             or a procedure from another package).
 *           additionalProperties:
 *             type: [boolean, "null"]
 *         schemas:
 *           oneOf:
 *             - $ref: '#/components/schemas/PackageSchemas'
 *             - type: "null"
 *           description: >
 *             The storage schemas the package carries. Null for a package
 *             stored before the registry kept them, until they are read.
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
 *         packageCommitment:
 *           type: string
 *           description: Commitment of the component package (32-byte hex).
 *         source:
 *           type: string
 *           description: >
 *             Identifier of the client that verified this component (e.g.
 *             `miden-verify`, `web-verifier`). Defaults to `unknown`.
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         package:
 *           $ref: '#/components/schemas/Package'
 *         debugPackage:
 *           type: [object, "null"]
 *           description: >
 *             The component package's debug build, whose debug info names
 *             call-trace frames, or null when it has none. Download it from
 *             `/v1/{networkId}/packages/masp/{packageCommitment}.debug.masp`.
 *           properties:
 *             commitment:
 *               type: string
 *               description: The debug build's own commitment (32-byte hex).
 *     VerifiedAccount:
 *       type: object
 *       description: >
 *         The verified account keyed on a network and an account code root,
 *         with every verified account component whose packages together make
 *         up the account's code: what
 *         `GET /v1/{networkId}/verified-accounts/code/{code}` answers.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         networkId:
 *           type: string
 *           description: The network the record is keyed on.
 *         code:
 *           type: string
 *           description: The account code root the record is keyed on (32-byte hex).
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         verifiedAccountComponents:
 *           type: array
 *           description: >
 *             The verified account components whose packages together make
 *             up the account's code.
 *           items:
 *             $ref: '#/components/schemas/VerifiedAccountComponent'
 *     StandardAccountComponent:
 *       type: object
 *       description: >
 *         A standard component (e.g. `BasicWallet`, `AuthSingleSig`) detected
 *         in an account's code, with the procedure roots it accounts for.
 *       properties:
 *         name:
 *           type: string
 *         procedures:
 *           type: array
 *           items:
 *             type: string
 *     VerifiedAccountById:
 *       description: >
 *         The same record, found through an account's on-chain code: what
 *         `GET /v1/{networkId}/verified-accounts/{accountId}` answers, with
 *         the queried id echoed back and what the on-chain lookup read of the
 *         code. Only the id-keyed endpoint returns those, as they come from
 *         the on-chain lookup.
 *       allOf:
 *         - $ref: '#/components/schemas/VerifiedAccount'
 *         - type: object
 *           properties:
 *             accountId:
 *               type: string
 *               description: The queried on-chain account identifier, echoed back.
 *             standardAccountComponents:
 *               type: array
 *               description: The standard components detected in the account's code.
 *               items:
 *                 $ref: '#/components/schemas/StandardAccountComponent'
 *             procedures:
 *               type: array
 *               description: Every procedure root (32-byte hex) in the account's code.
 *               items:
 *                 type: string
 *     VerifiedNote:
 *       type: object
 *       description: >
 *         The verified note keyed on a network and a note script root, with
 *         the compiled package it was verified against: what
 *         `GET /v1/{networkId}/verified-notes/script/{script}` answers.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         networkId:
 *           type: string
 *           description: The network the record is keyed on.
 *         script:
 *           type: string
 *           description: The note script root the record is keyed on (32-byte hex).
 *         source:
 *           type: string
 *           description: >
 *             Identifier of the client that originated the verification
 *             request. Defaults to `unknown`.
 *         packageId:
 *           type: string
 *           format: uuid
 *           description: Identifier of the package the note was verified against.
 *         packageCommitment:
 *           type: string
 *           description: Commitment of that package (32-byte hex).
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         package:
 *           $ref: '#/components/schemas/Package'
 *     VerifiedNoteById:
 *       description: >
 *         The same record, found through a note's on-chain script: what
 *         `GET /v1/{networkId}/verified-notes/{noteId}` answers, with the
 *         queried id echoed back.
 *       allOf:
 *         - $ref: '#/components/schemas/VerifiedNote'
 *         - type: object
 *           properties:
 *             noteId:
 *               type: string
 *               description: The queried on-chain note identifier, echoed back.
 *     VerificationResponse:
 *       type: object
 *       description: >
 *         Whether the project's package is the resource's on chain. A refused
 *         request (a project that doesn't build, a resource not on the
 *         network, a root already verified by it) is an error status, not
 *         `false`.
 *       properties:
 *         verified:
 *           type: boolean
 *   responses:
 *     CompilerUnavailable:
 *       description: >
 *         The compilation service could not be reached, or could not read the
 *         resource on-chain (`502`), is busy (`503`) or did not answer in time
 *         (`504`). This is temporary: retry later, after the number of seconds
 *         in `Retry-After` when present.
 *       headers:
 *         Retry-After:
 *           description: Seconds to wait before retrying.
 *           schema:
 *             type: integer
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 */

type CreateAppOptions = {
  /**
   * When provided, every request runs inside its own database connection built
   * by this factory and disposed when the response closes. Deployments that
   * cannot share a connection across requests (e.g. Cloudflare Workers) supply
   * this; the default Node server omits it and keeps the shared singleton.
   */
  requestDbFactory?: () => Database;
  /**
   * Where compiled packages (`.masp`) are stored. Defaults to a local directory
   * (`MASP_STORAGE_DIR`); deployments without a filesystem (e.g. Cloudflare
   * Workers) supply their own object storage.
   */
  maspStore?: MaspStore;
  /**
   * The api-compile the registry builds and verifies with. Defaults to the one
   * at `API_COMPILE_URL`; in-process tests pass a fake.
   */
  apiCompile?: ApiCompile;
};

export const createApp = ({
  requestDbFactory,
  maspStore,
  apiCompile,
}: CreateAppOptions = {}): Express => {
  const app = express();
  app.locals.maspStore = maspStore ?? createFsMaspStore(MASP_STORAGE_DIR);
  app.locals.apiCompile = apiCompile ?? createHttpApiCompile(API_COMPILE_URL);

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
      // Lets browser clients read how long to wait after a 503, and a debug
      // build's commitment next to its `.debug.masp`.
      exposedHeaders: ["Retry-After", "X-Debug-Commitment"],
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
  app.use("/v1", packagesRouterV1);
  app.use(adminRouter);
  app.use(notFound);
  app.use(hideQueryErrors);
  app.use(errorHandler);

  return app;
};
