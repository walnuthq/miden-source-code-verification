import { defineRelations } from "drizzle-orm";
import * as schema from "@/db/schema.js";

export const relations = defineRelations(schema, (r) => ({
  packagesTable: {
    verifiedAccountComponent: r.many.verifiedAccountComponentTable({
      from: r.packagesTable.id,
      to: r.verifiedAccountComponentTable.packageId,
    }),
    verifiedNote: r.many.verifiedNoteTable({
      from: r.packagesTable.id,
      to: r.verifiedNoteTable.packageId,
    }),
  },
  verifiedAccountTable: {
    verifiedAccountComponents: r.many.verifiedAccountComponentTable({
      from: r.verifiedAccountTable.id,
      to: r.verifiedAccountComponentTable.verifiedAccountId,
    }),
  },
  verifiedAccountComponentTable: {
    verifiedAccount: r.one.verifiedAccountTable({
      from: r.verifiedAccountComponentTable.verifiedAccountId,
      to: r.verifiedAccountTable.id,
      optional: false,
    }),
    package: r.one.packagesTable({
      from: r.verifiedAccountComponentTable.packageId,
      to: r.packagesTable.id,
      optional: false,
    }),
  },
  verifiedNoteTable: {
    package: r.one.packagesTable({
      from: r.verifiedNoteTable.packageId,
      to: r.packagesTable.id,
      optional: false,
    }),
  },
}));
