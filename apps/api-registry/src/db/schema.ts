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
  "note-script",
  "transaction-script",
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

export const verifiedAccountTable = pgTable("verified_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  networkId: text("network_id").notNull().default("mtst"),
  accountId: varchar("account_id", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifiedAccountComponentTable = pgTable(
  "verified_account_components",
  {
    id: uuid().primaryKey().defaultRandom(),
    verifiedAccountId: uuid("verified_account_id")
      .notNull()
      .references(() => verifiedAccountTable.id, { onDelete: "cascade" }),
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

export const verifiedNoteTable = pgTable("verified_notes", {
  id: uuid().primaryKey().defaultRandom(),
  networkId: text("network_id").notNull().default("mtst"),
  noteId: varchar("note_id", { length: 66 }).notNull(),
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
