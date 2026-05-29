import db from "@/db/index.js";
import { packagesTable } from "@/db/schema.js";

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
