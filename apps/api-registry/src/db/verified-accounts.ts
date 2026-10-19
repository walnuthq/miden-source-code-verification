import db from "@/db/index.js";
import { verifiedAccountCodeTable } from "@/db/schema.js";

export const getVerifiedAccountByCode = async ({
  networkId,
  code,
}: {
  networkId: string;
  code: string;
}) => {
  const verifiedAccount = await db.query.verifiedAccountCodeTable.findFirst({
    where: { networkId, code },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });
  if (!verifiedAccount) {
    return undefined;
  }
  return {
    ...verifiedAccount,
    // Whether the simulator can name a component's call-trace frames, without
    // fetching its debug build first.
    verifiedAccountComponents: verifiedAccount.verifiedAccountComponents.map(
      (component) => ({
        ...component,
        debugPackage: component.package.debugCommitment
          ? { commitment: component.package.debugCommitment }
          : null,
      }),
    ),
  };
};

export const insertVerifiedAccountCode = async ({
  networkId,
  code,
}: {
  networkId: string;
  code: string;
}) => {
  const [insertedVerifiedAccountCode] = await db
    .insert(verifiedAccountCodeTable)
    .values({
      networkId,
      code,
    })
    .returning({ id: verifiedAccountCodeTable.id });
  if (!insertedVerifiedAccountCode) {
    throw new Error("insert verified account code failed");
  }
  return insertedVerifiedAccountCode.id;
};
