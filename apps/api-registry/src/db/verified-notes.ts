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
  packageId,
  packageDigest,
}: {
  networkId: string;
  noteId: string;
  packageId: string;
  packageDigest: string;
}) => {
  const [insertedVerifiedNote] = await db
    .insert(verifiedNoteTable)
    .values({
      networkId,
      noteId,
      packageId,
      packageDigest,
    })
    .returning({ id: verifiedNoteTable.id });
  if (!insertedVerifiedNote) {
    throw new Error("insert verified note failed");
  }
  return insertedVerifiedNote.id;
};
