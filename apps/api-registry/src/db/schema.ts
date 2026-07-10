import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const packageTypeEnum = pgEnum("package_type", [
  "account",
  "note",
  "tx-script",
  "authentication-component",
]);

export const packagesTable = pgTable("packages", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull().default(""),
  type: packageTypeEnum().notNull().default("account"),
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

export const verifiedAccountCodeTable = pgTable("verified_accounts_code", {
  id: uuid().primaryKey().defaultRandom(),
  code: varchar({ length: 66 })
    .notNull()
    .default(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ),
  source: text().notNull().default("unknown"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

export const verifiedNoteScriptTable = pgTable("verified_notes_script", {
  id: uuid().primaryKey().defaultRandom(),
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
});
