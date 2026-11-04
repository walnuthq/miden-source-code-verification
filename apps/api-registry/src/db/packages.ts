import { eq } from "drizzle-orm";
import db from "./index.ts";
import { packagesTable } from "./schema.ts";

export type NewPackage = typeof packagesTable.$inferInsert;

export const insertPackage = async (newPackage: NewPackage) => {
  const [insertedPackage] = await db
    .insert(packagesTable)
    .values(newPackage)
    .returning({ id: packagesTable.id });
  if (!insertedPackage) {
    throw new Error("insert package failed");
  }
  return insertedPackage.id;
};

export const getPackage = (commitment: string) =>
  db.query.packagesTable.findFirst({
    where: { commitment },
  });

export const updatePackage = async (
  id: string,
  update: Pick<
    NewPackage,
    "entrypoint" | "debugCommitment" | "debugBuiltWith" | "readOnly"
  >,
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

// The read-only backfill's work list: packages, of every kind, whose
// procedures haven't been read yet. A note's entrypoint is listed on its page
// like an account's procedures.
export const getPackagesWithoutReadOnly = () =>
  db.query.packagesTable.findMany({
    columns: { id: true, name: true, commitment: true },
    where: { readOnly: { isNull: true } },
    orderBy: { createdAt: "asc" },
  });
