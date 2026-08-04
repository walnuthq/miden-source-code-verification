import db from "@/db/index.js";
import { verifiedAccountCodeTable } from "@/db/schema.js";

export const getVerifiedAccountByCode = ({
  networkId,
  code,
}: {
  networkId: string;
  code: string;
}) =>
  db.query.verifiedAccountCodeTable.findFirst({
    where: { networkId, code },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });

export const insertVerifiedAccountCode = async ({
  networkId,
  code,
  source,
}: {
  networkId: string;
  code: string;
  source: string;
}) => {
  const [insertedVerifiedAccountCode] = await db
    .insert(verifiedAccountCodeTable)
    .values({
      networkId,
      code,
      source,
    })
    .returning({ id: verifiedAccountCodeTable.id });
  if (!insertedVerifiedAccountCode) {
    throw new Error("insert verified account code failed");
  }
  return insertedVerifiedAccountCode.id;
};
