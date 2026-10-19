import { and, eq, inArray, lt, notExists } from "drizzle-orm";
import db from "@/db/index.js";
import {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "@/db/schema.js";
import type { MaspStore } from "@/storage/masp-store.js";

// The `source` the Miden playground verifies with. Its verifications are
// throwaway deploys, so they only live for a day.
export const PLAYGROUND_SOURCE = "miden-playground";
export const PLAYGROUND_TTL_MS = 24 * 60 * 60 * 1000;

const unique = <T>(values: T[]) => [...new Set(values)];

// Removes the playground's verified account components and notes older than
// `PLAYGROUND_TTL_MS`, then what only they used: the account codes left
// without a component, and the packages nothing references any more, along
// with their artifacts. A package or account code another source also
// verified stays.
export const cleanupPlaygroundResources = async ({
  maspStore,
  now = new Date(),
}: {
  maspStore: MaspStore;
  now?: Date;
}) => {
  const cutoff = new Date(now.getTime() - PLAYGROUND_TTL_MS);
  const deleted = await db.transaction(async (tx) => {
    const components = await tx
      .delete(verifiedAccountComponentTable)
      .where(
        and(
          eq(verifiedAccountComponentTable.source, PLAYGROUND_SOURCE),
          lt(verifiedAccountComponentTable.createdAt, cutoff),
        ),
      )
      .returning({
        verifiedAccountId: verifiedAccountComponentTable.verifiedAccountId,
        packageId: verifiedAccountComponentTable.packageId,
      });
    const notes = await tx
      .delete(verifiedNoteScriptTable)
      .where(
        and(
          eq(verifiedNoteScriptTable.source, PLAYGROUND_SOURCE),
          lt(verifiedNoteScriptTable.createdAt, cutoff),
        ),
      )
      .returning({ packageId: verifiedNoteScriptTable.packageId });

    const accountIds = unique(components.map((c) => c.verifiedAccountId));
    const accounts = accountIds.length
      ? await tx
          .delete(verifiedAccountCodeTable)
          .where(
            and(
              inArray(verifiedAccountCodeTable.id, accountIds),
              notExists(
                tx
                  .select({ id: verifiedAccountComponentTable.id })
                  .from(verifiedAccountComponentTable)
                  .where(
                    eq(
                      verifiedAccountComponentTable.verifiedAccountId,
                      verifiedAccountCodeTable.id,
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: verifiedAccountCodeTable.id })
      : [];

    const packageIds = unique(
      [...components, ...notes].map(({ packageId }) => packageId),
    );
    const packages = packageIds.length
      ? await tx
          .delete(packagesTable)
          .where(
            and(
              inArray(packagesTable.id, packageIds),
              notExists(
                tx
                  .select({ id: verifiedAccountComponentTable.id })
                  .from(verifiedAccountComponentTable)
                  .where(
                    eq(
                      verifiedAccountComponentTable.packageId,
                      packagesTable.id,
                    ),
                  ),
              ),
              notExists(
                tx
                  .select({ id: verifiedNoteScriptTable.id })
                  .from(verifiedNoteScriptTable)
                  .where(
                    eq(verifiedNoteScriptTable.packageId, packagesTable.id),
                  ),
              ),
            ),
          )
          .returning({ commitment: packagesTable.commitment })
      : [];

    return { components, notes, accounts, packages };
  });

  // Artifacts are keyed by commitment, so one stays while another package row
  // still has it. Deleted after the rows, so a row never outlives its
  // artifact.
  const commitments = unique(deleted.packages.map((p) => p.commitment));
  const kept = commitments.length
    ? await db
        .select({ commitment: packagesTable.commitment })
        .from(packagesTable)
        .where(inArray(packagesTable.commitment, commitments))
    : [];
  const keptCommitments = new Set(kept.map((p) => p.commitment));
  const orphaned = commitments.filter((c) => !keptCommitments.has(c));
  for (const commitment of orphaned) {
    await maspStore.delete(commitment, "release");
    await maspStore.delete(commitment, "debug");
  }

  return {
    verifiedAccountComponents: deleted.components.length,
    verifiedAccounts: deleted.accounts.length,
    verifiedNotes: deleted.notes.length,
    packages: deleted.packages.length,
    masps: orphaned.length,
  };
};
