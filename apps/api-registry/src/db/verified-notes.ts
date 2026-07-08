import db from "@/db/index.js";
import { verifiedNoteTable } from "@/db/schema.js";

export const getVerifiedNote = ({
  networkId,
  noteId,
}: {
  networkId: string;
  noteId: string;
}) =>
  db.query.verifiedNoteTable.findFirst({
    where: { networkId, noteId },
    with: { package: true },
  });

export const insertVerifiedNote = async ({
  networkId,
  noteId,
  source,
  packageId,
  packageDigest,
}: {
  networkId: string;
  noteId: string;
  source: string;
  packageId: string;
  packageDigest: string;
}) => {
  const [insertedVerifiedNote] = await db
    .insert(verifiedNoteTable)
    .values({
      networkId,
      noteId,
      source,
      packageId,
      packageDigest,
    })
    .returning({ id: verifiedNoteTable.id });
  if (!insertedVerifiedNote) {
    throw new Error("insert verified note failed");
  }
  return insertedVerifiedNote.id;
};
