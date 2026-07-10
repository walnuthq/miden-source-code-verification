import db from "@/db/index.js";
import { verifiedAccountCodeTable } from "@/db/schema.js";

export const getVerifiedAccountByCode = ({ code }: { code: string }) =>
  db.query.verifiedAccountCodeTable.findFirst({
    where: { code },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });

export const insertVerifiedAccountCode = async ({
  code,
  source,
}: {
  code: string;
  source: string;
}) => {
  const [insertedVerifiedAccountCode] = await db
    .insert(verifiedAccountCodeTable)
    .values({
      code,
      source,
    })
    .returning({ id: verifiedAccountCodeTable.id });
  if (!insertedVerifiedAccountCode) {
    throw new Error("insert verified account code failed");
  }
  return insertedVerifiedAccountCode.id;
};
