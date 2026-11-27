import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  type Manifest,
  type ProcedureParameters,
  type ReadOnlyProcedures,
  TARGET_TYPES,
} from "miden-source-code-verification-utils/manifest";

// The kind of a package: `miden-mast-package`'s `TargetType`, from the same
// list that types a manifest dependency's `kind`.
export const packageTypeEnum = pgEnum("package_type", TARGET_TYPES);

export const packagesTable = pgTable(
  "packages",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 255 }).notNull().default(""),
    type: packageTypeEnum().notNull().default("account-component"),
    // The sources, keyed by project-relative path (the project as sent), and
    // the manifest, as api-compile answers them. A row stored before cargo
    // left api-compile is Rust-built when its files hold a `Cargo.toml` at its
    // entrypoint, or has no entrypoint; the deletion of Rust packages
    // removes those (`lib/rust-packages.ts`).
    // Typed after the `{}` defaults, which predate both being required: an
    // insert always supplies them.
    files: jsonb().notNull().default({}).$type<Record<string, string>>(),
    commitment: varchar({ length: 66 })
      .notNull()
      .default("0x0000000000000000000000000000000000000000000000000000000000000000"),
    manifest: jsonb().notNull().default({}).$type<Manifest>(),
    // The project directory within `files` the package was built from (`.` for
    // the root). Null on rows from before it was recorded.
    entrypoint: text(),
    // The toolchain of the build: api-compile's `builtWith` (the assembler's
    // crate versions), or `cargo miden --version` on a Rust package stored
    // before. Null when unknown.
    builtWith: varchar("built_with", { length: 64 }),
    // A Rust package's debug build, stored as `<commitment>.debug.masp` before
    // debug builds were retired: its own commitment, and the cargo-miden that
    // built it. Nothing reads or writes them any more; `spec/remove-rust`
    // plan 10 drops them.
    debugCommitment: varchar("debug_commitment", { length: 66 }),
    debugBuiltWith: varchar("debug_built_with", { length: 64 }),
    // Whether each exported procedure is read-only, by export path, as
    // api-compile reads it from the package (`ReadOnlyProcedures`). Without a
    // default, like `networkId`, so an insert that forgets it fails to compile.
    readOnly: jsonb("read_only").$type<ReadOnlyProcedures>().notNull(),
    // A Rust package's storage schemas. A MASM package has none, so nothing
    // reads or writes them any more and new rows get the `{}` default;
    // `spec/remove-rust` plan 10 drops the column.
    schemas: jsonb().notNull().default({}),
    // Each exported procedure's parameter names and types, as api-compile
    // reads them from the MASM source (`ProcedureParameters`): `{}` when it
    // couldn't. Without a default, like `readOnly`, so an insert that forgets
    // it fails to compile.
    parameters: jsonb().$type<ProcedureParameters>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One row per package. `verifyResource` reads then inserts, so without it
    // two concurrent verifications of a new package would each create a row
    // for the one artifact, keyed by commitment. It also backs every lookup
    // by commitment: `getPackage` and the artifact routes.
    uniqueIndex("packages_commitment_idx").on(table.commitment),
  ],
);

export const verifiedAccountCodeTable = pgTable(
  "verified_accounts_code",
  {
    id: uuid().primaryKey().defaultRandom(),
    // A code root only means something within a network, so records are keyed on
    // the pair. Deliberately without a default, unlike the other scalars here: a
    // default would silently mis-key a record, and omitting it makes `networkId`
    // required in the insert type so a forgotten call site fails to compile.
    networkId: varchar("network_id", { length: 16 }).notNull(),
    code: varchar({ length: 66 })
      .notNull()
      .default("0x0000000000000000000000000000000000000000000000000000000000000000"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // The registry's real key. Unique so that two concurrent verifications of
    // the same code share one row: `verifyResource` inserts on conflict do
    // nothing and then reads the row that won.
    // A unique *index* rather than a bare constraint: it doubles as the index
    // for the `(networkId, code)` lookup both read routes perform.
    uniqueIndex("verified_accounts_code_network_id_code_idx").on(table.networkId, table.code),
  ],
);

export const verifiedAccountComponentTable = pgTable(
  "verified_account_components",
  {
    id: uuid().primaryKey().defaultRandom(),
    verifiedAccountId: uuid("verified_account_id")
      .notNull()
      .references(() => verifiedAccountCodeTable.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packagesTable.id, { onDelete: "cascade" }),
    packageCommitment: varchar({ length: 66 })
      .notNull()
      .default("0x0000000000000000000000000000000000000000000000000000000000000000"),
    // The client that verified this component. Kept here rather than on the
    // account code, which later components are verified into, or on the
    // package, which is shared by every resource compiled to the same
    // commitment.
    source: text().notNull().default("unknown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One component per package in an account code. A conflict on it is the
    // "account component already verified" guard in `verifyResource`,
    // concurrent or not.
    uniqueIndex("verified_account_components_account_commitment_idx").on(
      table.verifiedAccountId,
      table.packageCommitment,
    ),
  ],
);

export const verifiedNoteScriptTable = pgTable(
  "verified_notes_script",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Keyed on (networkId, script) — see the note on `verifiedAccountCodeTable`.
    networkId: varchar("network_id", { length: 16 }).notNull(),
    script: varchar({ length: 66 })
      .notNull()
      .default("0x0000000000000000000000000000000000000000000000000000000000000000"),
    source: text().notNull().default("unknown"),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packagesTable.id, { onDelete: "cascade" }),
    packageCommitment: varchar({ length: 66 })
      .notNull()
      .default("0x0000000000000000000000000000000000000000000000000000000000000000"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // See the note on `verifiedAccountCodeTable`. Here a conflict on it is the
    // "note already verified" guard in `verifyResource`, concurrent or not.
    uniqueIndex("verified_notes_script_network_id_script_idx").on(table.networkId, table.script),
  ],
);
