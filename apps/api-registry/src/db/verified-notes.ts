import db from "@/db/index.js";
import { verifiedNoteScriptTable } from "@/db/schema.js";

export const getVerifiedNoteByScript = ({ script }: { script: string }) =>
  db.query.verifiedNoteScriptTable.findFirst({
    where: { script },
    with: { package: true },
  });

export const insertVerifiedNoteScript = async ({
  script,
  source,
  packageId,
  packageDigest,
}: {
  script: string;
  source: string;
  packageId: string;
  packageDigest: string;
}) => {
  const [insertedVerifiedNoteScript] = await db
    .insert(verifiedNoteScriptTable)
    .values({
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
