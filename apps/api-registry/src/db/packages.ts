import { eq } from "drizzle-orm";
import type { PackageSchemas } from "miden-source-code-verification-utils/manifest";
import db from "./index.ts";
import { packagesTable } from "./schema.ts";

export type NewPackage = typeof packagesTable.$inferInsert;

export const getPackage = (commitment: string) =>
  db.query.packagesTable.findFirst({
    where: { commitment },
  });

export const updatePackage = async (
  id: string,
  update: Pick<NewPackage, "entrypoint" | "debugCommitment" | "debugBuiltWith">,
) => {
  await db
    .update(packagesTable)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(packagesTable.id, id));
};

// The backfill's work list: account components with no debug build yet. Notes
// are left out, as the simulator only calls account procedures.
export const getPackagesWithoutDebugBuild = () =>
  db.query.packagesTable.findMany({
    columns: { id: true, name: true, commitment: true, entrypoint: true },
    where: { type: "account-component", debugCommitment: { isNull: true } },
    orderBy: { createdAt: "asc" },
  });

// The `schemas` column of what api-compile read of a package: only the
// schemas it has, so `{}` for one with none (no keys set to `undefined`).
export const schemasOf = ({
  storage,
  noteStorage,
}: PackageSchemas): PackageSchemas => ({
  ...(storage && { storage }),
  ...(noteStorage && { noteStorage }),
});
