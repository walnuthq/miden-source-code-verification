import db from "@/db/index.js";
import { verifiedNoteScriptTable } from "@/db/schema.js";

export const getVerifiedNoteByScript = ({
  networkId,
  script,
}: {
  networkId: string;
  script: string;
}) =>
  db.query.verifiedNoteScriptTable.findFirst({
    where: { networkId, script },
    with: { package: true },
  });

export const insertVerifiedNoteScript = async ({
  networkId,
  script,
  source,
  packageId,
  packageDigest,
}: {
  networkId: string;
  script: string;
  source: string;
  packageId: string;
  packageDigest: string;
}) => {
  const [insertedVerifiedNoteScript] = await db
    .insert(verifiedNoteScriptTable)
    .values({
      networkId,
      script,
      source,
      packageId,
      packageDigest,
    })
    .returning({ id: verifiedNoteScriptTable.id });
  if (!insertedVerifiedNoteScript) {
    throw new Error("insert verified note script failed");
  }
  return insertedVerifiedNoteScript.id;
};
