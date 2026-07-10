import { defineRelations } from "drizzle-orm";
import * as schema from "@/db/schema.js";

export const relations = defineRelations(schema, (r) => ({
  packagesTable: {
    verifiedAccountComponent: r.many.verifiedAccountComponentTable({
      from: r.packagesTable.id,
      to: r.verifiedAccountComponentTable.packageId,
    }),
    verifiedNote: r.many.verifiedNoteScriptTable({
      from: r.packagesTable.id,
      to: r.verifiedNoteScriptTable.packageId,
    }),
  },
  verifiedAccountCodeTable: {
    verifiedAccountComponents: r.many.verifiedAccountComponentTable({
      from: r.verifiedAccountCodeTable.id,
      to: r.verifiedAccountComponentTable.verifiedAccountId,
    }),
  },
  verifiedAccountComponentTable: {
    verifiedAccount: r.one.verifiedAccountCodeTable({
      from: r.verifiedAccountComponentTable.verifiedAccountId,
      to: r.verifiedAccountCodeTable.id,
      optional: false,
    }),
    package: r.one.packagesTable({
      from: r.verifiedAccountComponentTable.packageId,
      to: r.packagesTable.id,
      optional: false,
    }),
  },
  verifiedNoteScriptTable: {
    package: r.one.packagesTable({
      from: r.verifiedNoteScriptTable.packageId,
      to: r.packagesTable.id,
      optional: false,
    }),
  },
}));
