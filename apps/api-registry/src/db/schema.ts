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

export const packageTypeEnum = pgEnum("package_type", [
  "library",
  "account-component",
  "authentication-component",
  "note",
  "tx-script",
]);

export const packagesTable = pgTable("packages", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull().default(""),
  type: packageTypeEnum().notNull().default("account-component"),
  files: jsonb().notNull().default({}),
  masp: text().notNull().default(""),
  digest: varchar({ length: 66 })
    .notNull()
    .default(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ),
  manifest: jsonb().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
      .default(
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ),
    source: text().notNull().default("unknown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // The registry's real key. Unique because `verifyAccountComponent` reads
    // then inserts, so without it two concurrent verifications of the same code
    // would each create a row and later lookups would see only one of them.
    // A unique *index* rather than a bare constraint: it doubles as the index
    // for the `(networkId, code)` lookup both read routes perform.
    uniqueIndex("verified_accounts_code_network_id_code_idx").on(
      table.networkId,
      table.code,
    ),
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
    packageDigest: varchar({ length: 66 })
      .notNull()
      .default(
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export const verifiedNoteScriptTable = pgTable(
  "verified_notes_script",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Keyed on (networkId, script) — see the note on `verifiedAccountCodeTable`.
    networkId: varchar("network_id", { length: 16 }).notNull(),
    script: varchar({ length: 66 })
      .notNull()
      .default(
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ),
    source: text().notNull().default("unknown"),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packagesTable.id, { onDelete: "cascade" }),
    packageDigest: varchar({ length: 66 })
      .notNull()
      .default(
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // See the note on `verifiedAccountCodeTable` — same reasoning, and here it
    // also backs the "note already verified" guard in `verifyNote`.
    uniqueIndex("verified_notes_script_network_id_script_idx").on(
      table.networkId,
      table.script,
    ),
  ],
);
