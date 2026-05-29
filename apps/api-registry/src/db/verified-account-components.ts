import db from "@/db/index.js";
import { verifiedAccountComponentTable } from "@/db/schema.js";

export const getVerifiedAccountComponent = ({
  verifiedAccountId,
  packageDigest,
}: {
  verifiedAccountId: string;
  packageDigest: string;
}) =>
  db.query.verifiedAccountComponentTable.findFirst({
    where: { verifiedAccountId, packageDigest },
    with: { package: true },
  });

export const insertVerifiedAccountComponent = async ({
  verifiedAccountId,
  packageId,
  packageDigest,
}: {
  verifiedAccountId: string;
  packageId: string;
  packageDigest: string;
}) => {
  const [insertedVerifiedAccountComponent] = await db
    .insert(verifiedAccountComponentTable)
    .values({
      verifiedAccountId,
      packageId,
      packageDigest,
    })
    .returning({ id: verifiedAccountComponentTable.id });
  if (!insertedVerifiedAccountComponent) {
    throw new Error("insert verified account component failed");
  }
  return insertedVerifiedAccountComponent.id;
};
