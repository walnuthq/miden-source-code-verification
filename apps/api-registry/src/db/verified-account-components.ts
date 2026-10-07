import db from "@/db/index.js";
import { verifiedAccountComponentTable } from "@/db/schema.js";

export const getVerifiedAccountComponent = ({
  verifiedAccountId,
  packageCommitment,
}: {
  verifiedAccountId: string;
  packageCommitment: string;
}) =>
  db.query.verifiedAccountComponentTable.findFirst({
    where: { verifiedAccountId, packageCommitment },
    with: { package: true },
  });

export const insertVerifiedAccountComponent = async ({
  verifiedAccountId,
  packageId,
  packageCommitment,
  source,
}: {
  verifiedAccountId: string;
  packageId: string;
  packageCommitment: string;
  source: string;
}) => {
  const [insertedVerifiedAccountComponent] = await db
    .insert(verifiedAccountComponentTable)
    .values({
      verifiedAccountId,
      packageId,
      packageCommitment,
      source,
    })
    .returning({ id: verifiedAccountComponentTable.id });
  if (!insertedVerifiedAccountComponent) {
    throw new Error("insert verified account component failed");
  }
  return insertedVerifiedAccountComponent.id;
};
