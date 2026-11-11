import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { VerifyResponse } from "miden-source-code-verification-utils/api-compile";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import type { Project } from "miden-source-code-verification-utils/project";
import db, { type Database } from "../db/index.ts";
import { getPackage } from "../db/packages.ts";
import {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "../db/schema.ts";
import type { MaspStore } from "../storage/masp-store.ts";
import type { ApiCompile } from "./api-compile.ts";
import { storeDebugBuild } from "./debug-build.ts";
import { PLAYGROUND_SOURCE } from "./playground.ts";

// The on-chain resource a verification or a lookup is for, named by its id.
export type Resource =
  | { kind: "account"; accountId: string }
  | { kind: "note"; noteId: string };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// The conflict clause of a verified record's insert: a conflict is the root
// verified before, or by a concurrent verification that committed first. A
// record the playground made is a throwaway deploy cleanup deletes within a
// day, so a verification from any other source takes it over with `set` and
// the root stays verified. Any other conflict changes nothing and returns no
// row: already verified.
const onConflictTakeOverPlayground = <TSet, TInsert>(
  insert: {
    onConflictDoNothing(config: { target: PgColumn[] }): TInsert;
    onConflictDoUpdate(config: {
      target: PgColumn[];
      set: TSet;
      setWhere: SQL;
    }): TInsert;
  },
  {
    source,
    target,
    sourceColumn,
    set,
  }: {
    source: string;
    target: PgColumn[];
    sourceColumn: PgColumn;
    set: TSet;
  },
) =>
  source === PLAYGROUND_SOURCE
    ? insert.onConflictDoNothing({ target })
    : insert.onConflictDoUpdate({
        target,
        set,
        setWhere: eq(sourceColumn, PLAYGROUND_SOURCE),
      });

// The package's row: inserted, or found when a concurrent verification of the
// same new package inserted it since the read outside the transaction.
const insertPackage = async (
  tx: Transaction,
  { name, entrypoint }: Project,
  build: VerifyResponse,
) => {
  const [inserted] = await tx
    .insert(packagesTable)
    .values({
      name,
      type: build.kind,
      // Keeps the lockfile with the sources, so the record pins the
      // dependency versions that produced `commitment`.
      files: build.files,
      commitment: build.commitment,
      manifest: build.manifest,
      readOnly: build.readOnly,
      entrypoint,
      builtWith: build.cargoMidenVersion,
    })
    .onConflictDoNothing({ target: packagesTable.commitment })
    .returning({ id: packagesTable.id });
  if (inserted) {
    return inserted.id;
  }
  const existing = await tx.query.packagesTable.findFirst({
    columns: { id: true },
    where: { commitment: build.commitment },
  });
  if (!existing) {
    throw new Error("insert package conflicted, but no row has its commitment");
  }
  return existing.id;
};

// The account code's verified account: inserted, or found when it exists,
// whether from an earlier verification or a concurrent one that inserted it
// since this one started.
const insertVerifiedAccount = async (
  tx: Transaction,
  networkId: string,
  code: string,
) => {
  const [inserted] = await tx
    .insert(verifiedAccountCodeTable)
    .values({ networkId, code })
    .onConflictDoNothing({
      target: [
        verifiedAccountCodeTable.networkId,
        verifiedAccountCodeTable.code,
      ],
    })
    .returning({ id: verifiedAccountCodeTable.id });
  if (inserted) {
    return inserted.id;
  }
  const existing = await tx.query.verifiedAccountCodeTable.findFirst({
    columns: { id: true },
    where: { networkId, code },
  });
  if (!existing) {
    throw new Error(
      "insert verified account conflicted, but no row has its code",
    );
  }
  return existing.id;
};

// Records the package as a component of the account code, under the verified
// account the code already has, or a new one.
const insertAccountComponent = async (
  tx: Transaction,
  {
    networkId,
    code,
    packageId,
    packageCommitment,
    source,
  }: {
    networkId: string;
    code: string;
    packageId: string;
    packageCommitment: string;
    source: string;
  },
) => {
  const verifiedAccountId = await insertVerifiedAccount(tx, networkId, code);
  // Keyed on the package within the code: the root is verified by this very
  // package.
  const now = new Date();
  const [inserted] = await onConflictTakeOverPlayground(
    tx
      .insert(verifiedAccountComponentTable)
      .values({ verifiedAccountId, packageId, packageCommitment, source }),
    {
      source,
      target: [
        verifiedAccountComponentTable.verifiedAccountId,
        verifiedAccountComponentTable.packageCommitment,
      ],
      sourceColumn: verifiedAccountComponentTable.source,
      set: { source, packageId, createdAt: now, updatedAt: now },
    },
  ).returning({ id: verifiedAccountComponentTable.id });
  if (!inserted) {
    throw new HttpError(409, "account component already verified");
  }
};

const insertNote = async (
  tx: Transaction,
  {
    networkId,
    script,
    packageId,
    packageCommitment,
    source,
  }: {
    networkId: string;
    script: string;
    packageId: string;
    packageCommitment: string;
    source: string;
  },
) => {
  // Keyed on the script root alone, so a taken-over record also takes this
  // verification's package.
  const now = new Date();
  const [inserted] = await onConflictTakeOverPlayground(
    tx
      .insert(verifiedNoteScriptTable)
      .values({ networkId, script, source, packageId, packageCommitment }),
    {
      source,
      target: [
        verifiedNoteScriptTable.networkId,
        verifiedNoteScriptTable.script,
      ],
      sourceColumn: verifiedNoteScriptTable.source,
      set: {
        source,
        packageId,
        packageCommitment,
        createdAt: now,
        updatedAt: now,
      },
    },
  ).returning({ id: verifiedNoteScriptTable.id });
  if (!inserted) {
    throw new HttpError(409, "note already verified");
  }
};

/**
 * Verifies that `project` compiles to the resource's package on `networkId`
 * and, when it does, records it: the package with its artifact, and the
 * verified account component or verified note keyed on the resource's root.
 * Returns whether it verified. Throws a 409 `HttpError` when the root is
 * already verified: for an account, by this very package, since an account
 * code is made of several; for a note, at all, since a note's script root is
 * its package's commitment. A record whose source is the playground's is
 * taken over by a verification from any other source instead.
 */
export const verifyResource = async ({
  networkId,
  resource,
  project,
  source = "unknown",
  maspStore,
  apiCompile,
  signal,
}: {
  networkId: string;
  resource: Resource;
  project: Project;
  source?: string;
  maspStore: MaspStore;
  apiCompile: ApiCompile;
  /** Aborts the build, as when the client went away. */
  signal?: AbortSignal;
}) => {
  const resourceId =
    resource.kind === "account" ? resource.accountId : resource.noteId;
  const build = await apiCompile.verify({
    project,
    networkId,
    resourceId,
    // The debug build names call-trace frames in the simulator, which only
    // runs account procedures.
    debug: resource.kind === "account",
    signal,
  });
  if (!build.verified) {
    return false;
  }
  // The root the verifier read on chain, which the record is keyed on.
  const { commitment, root } = build;
  const stored = await getPackage(commitment);
  if (!stored) {
    // Stored before the rows, so a package never exists without its
    // artifact. Keyed by commitment, so a retry after a failed transaction
    // just rewrites the same object.
    await maspStore.put(commitment, Buffer.from(build.masp, "base64"));
  }
  // The package and its record commit together: a verification is recorded
  // whole or not at all.
  const packageId = await db.transaction(async (tx) => {
    const packageId = stored?.id ?? (await insertPackage(tx, project, build));
    if (resource.kind === "account") {
      await insertAccountComponent(tx, {
        networkId,
        code: root,
        packageId,
        packageCommitment: commitment,
        source,
      });
    } else {
      await insertNote(tx, {
        networkId,
        script: root,
        packageId,
        packageCommitment: commitment,
        source,
      });
    }
    return packageId;
  });
  // After the commit, so its failure can't undo the record: it is logged and
  // leaves the package without one, as the release build alone is what
  // verifies. Also for a package stored before it had a debug build.
  if (!stored?.debugCommitment) {
    await storeDebugBuild({
      maspStore,
      packageId,
      commitment,
      debug: build.debug,
    }).catch((error) => console.error(error));
  }
  return true;
};
