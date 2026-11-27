import { asc, count, eq, inArray, sql } from "drizzle-orm";

import db from "../db/index.ts";
import {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "../db/schema.ts";
import { debugMaspKey, type MaspStore, maspKey } from "../storage/masp-store.ts";

// The deletion of the Rust-built packages (`spec/remove-rust`, decision 6):
// every package cargo-miden built, every verified account with a component
// built from one, every verified note built from one, and their stored files.
// Those accounts and notes show as not verified afterwards. A verified account
// goes whole, its MASM components with it, as it can't be verified any more
// with part of its code; a MASM package it used stays. Runs from the admin
// routes, driven by `scripts/delete-rust-packages.ts`.

// The Rust-built rows, in SQL so no row's files leave the database: a
// `Cargo.toml` at the entrypoint, or no entrypoint recorded (a row stored
// before entrypoints were, when every project was a Rust one).
export const rustPackageCondition = sql`(${packagesTable.entrypoint} IS NULL OR ${packagesTable.files} ? (CASE WHEN ${packagesTable.entrypoint} = '.' THEN 'Cargo.toml' ELSE ${packagesTable.entrypoint} || '/Cargo.toml' END))`;

// What one network holds that the deletion removes: the code roots of its
// verified accounts, the script roots of its verified notes, and the Rust
// packages they were verified with and their files. `mixedAccounts` are the
// accounts among them with a MASM component too, which goes with the account.
// A package is on every network it has a record on, and on none without one.
type NetworkReport = {
  packages: string[];
  files: string[];
  verifiedAccounts: string[];
  mixedAccounts: string[];
  verifiedNotes: string[];
};

export type RustPackagesReport = {
  networks: Record<string, NetworkReport>;
  // Every Rust package, with no verified record or with some, by commitment.
  packages: { commitment: string; name: string }[];
  // The keys of the stored files that go, for every package: each one's
  // `.masp`, and the `.debug.masp` of one that had a debug build.
  files: string[];
  counts: {
    packages: number;
    verifiedAccounts: number;
    verifiedNotes: number;
    files: number;
  };
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

// The ids of the verified accounts with a component built from one of the
// packages `packageIds`, as a subquery.
const accountsWithComponentsOf = (query: Pick<typeof db, "select">, packageIds: string[]) =>
  query
    .select({ id: verifiedAccountComponentTable.verifiedAccountId })
    .from(verifiedAccountComponentTable)
    .where(inArray(verifiedAccountComponentTable.packageId, packageIds));

/** The dry run: what the deletion would remove, per network. Deletes nothing. */
export const listRustPackages = async (): Promise<RustPackagesReport> => {
  const packages = await db
    .select({
      id: packagesTable.id,
      commitment: packagesTable.commitment,
      name: packagesTable.name,
      debugCommitment: packagesTable.debugCommitment,
    })
    .from(packagesTable)
    .where(rustPackageCondition)
    .orderBy(asc(packagesTable.commitment));
  const commitmentOf = new Map(packages.map((row) => [row.id, row.commitment]));
  const ids = [...commitmentOf.keys()];

  // Every component of an account with a Rust component, so an account's MASM
  // components show too.
  const accountsWithRust = accountsWithComponentsOf(db, ids);
  const components = ids.length
    ? await db
        .select({
          networkId: verifiedAccountCodeTable.networkId,
          code: verifiedAccountCodeTable.code,
          packageId: verifiedAccountComponentTable.packageId,
        })
        .from(verifiedAccountComponentTable)
        .innerJoin(
          verifiedAccountCodeTable,
          eq(verifiedAccountComponentTable.verifiedAccountId, verifiedAccountCodeTable.id),
        )
        .where(inArray(verifiedAccountCodeTable.id, accountsWithRust))
    : [];
  const notes = ids.length
    ? await db
        .select({
          networkId: verifiedNoteScriptTable.networkId,
          script: verifiedNoteScriptTable.script,
          packageId: verifiedNoteScriptTable.packageId,
        })
        .from(verifiedNoteScriptTable)
        .where(inArray(verifiedNoteScriptTable.packageId, ids))
    : [];

  const networks: Record<string, NetworkReport> = {};
  const network = (networkId: string) =>
    (networks[networkId] ??= {
      packages: [],
      files: [],
      verifiedAccounts: [],
      mixedAccounts: [],
      verifiedNotes: [],
    });
  for (const { networkId, code, packageId } of components) {
    const report = network(networkId);
    report.verifiedAccounts.push(code);
    const commitment = commitmentOf.get(packageId);
    if (commitment) {
      report.packages.push(commitment);
    } else {
      report.mixedAccounts.push(code);
    }
  }
  for (const { networkId, script, packageId } of notes) {
    const report = network(networkId);
    report.verifiedNotes.push(script);
    const commitment = commitmentOf.get(packageId);
    if (commitment) {
      report.packages.push(commitment);
    }
  }
  const filesOf = new Map(
    packages.map(({ commitment, debugCommitment }) => [
      commitment,
      debugCommitment ? [maspKey(commitment), debugMaspKey(commitment)] : [maspKey(commitment)],
    ]),
  );
  for (const report of Object.values(networks)) {
    report.packages = sorted(report.packages);
    report.files = report.packages.flatMap((commitment) => filesOf.get(commitment) ?? []);
    report.verifiedAccounts = sorted(report.verifiedAccounts);
    report.mixedAccounts = sorted(report.mixedAccounts);
    report.verifiedNotes = sorted(report.verifiedNotes);
  }

  const files = [...filesOf.values()].flat();
  const reports = Object.values(networks);
  return {
    networks,
    packages: packages.map(({ commitment, name }) => ({ commitment, name })),
    files,
    counts: {
      packages: packages.length,
      verifiedAccounts: reports.reduce((sum, report) => sum + report.verifiedAccounts.length, 0),
      verifiedNotes: reports.reduce((sum, report) => sum + report.verifiedNotes.length, 0),
      files: files.length,
    },
  };
};

export type RustPackagesDeletion = {
  packages: number;
  verifiedAccounts: number;
  verifiedNotes: number;
  // The Rust packages still stored: the next call deletes the next batch.
  remaining: number;
};

/**
 * Deletes up to `limit` Rust packages, with the verified accounts and notes
 * that point at them, then their files: the rows first, in one transaction,
 * so no record ever points at a missing file. Safe to run again: a second run
 * finds nothing left. Bounded so one Worker request stays well within its
 * limits; call it until `remaining` is 0.
 */
export const deleteRustPackages = async ({
  maspStore,
  limit,
}: {
  maspStore: MaspStore;
  limit: number;
}): Promise<RustPackagesDeletion> => {
  const deleted = await db.transaction(async (tx) => {
    const batch = await tx
      .select({ id: packagesTable.id })
      .from(packagesTable)
      .where(rustPackageCondition)
      .orderBy(asc(packagesTable.id))
      .limit(limit)
      .for("update");
    const ids = batch.map(({ id }) => id);
    if (ids.length === 0) {
      return { packages: [], accounts: [], notes: [] };
    }
    // The account codes first: deleting one deletes its components, MASM ones
    // included.
    const accounts = await tx
      .delete(verifiedAccountCodeTable)
      .where(inArray(verifiedAccountCodeTable.id, accountsWithComponentsOf(tx, ids)))
      .returning({ id: verifiedAccountCodeTable.id });
    const notes = await tx
      .delete(verifiedNoteScriptTable)
      .where(inArray(verifiedNoteScriptTable.packageId, ids))
      .returning({ id: verifiedNoteScriptTable.id });
    const packages = await tx
      .delete(packagesTable)
      .where(inArray(packagesTable.id, ids))
      .returning({ commitment: packagesTable.commitment });
    return { packages, accounts, notes };
  });

  // One row per commitment, so a deleted row's files go with it.
  for (const { commitment } of deleted.packages) {
    await maspStore.delete(commitment);
  }

  const [left] = await db
    .select({ count: count() })
    .from(packagesTable)
    .where(rustPackageCondition);
  return {
    packages: deleted.packages.length,
    verifiedAccounts: deleted.accounts.length,
    verifiedNotes: deleted.notes.length,
    remaining: left?.count ?? 0,
  };
};
