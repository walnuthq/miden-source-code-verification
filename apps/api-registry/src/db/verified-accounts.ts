import db from "@/db/index.js";
import { verifiedAccountTable } from "@/db/schema.js";

export const getVerifiedAccount = ({
  networkId,
  accountId,
}: {
  networkId: string;
  accountId: string;
}) =>
  db.query.verifiedAccountTable.findFirst({
    where: { networkId, accountId },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });

export const insertVerifiedAccount = async ({
  networkId,
  accountId,
  source,
}: {
  networkId: string;
  accountId: string;
  source: string;
}) => {
  const [insertedVerifiedAccount] = await db
    .insert(verifiedAccountTable)
    .values({
      networkId,
      accountId,
      source,
    })
    .returning({ id: verifiedAccountTable.id });
  if (!insertedVerifiedAccount) {
    throw new Error("insert verified account failed");
  }
  return insertedVerifiedAccount.id;
};
