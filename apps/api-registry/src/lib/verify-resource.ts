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
import type { ApiCompile, VerifyResult } from "./api-compile.ts";
import { storeDebugBuild } from "./debug-build.ts";

// The on-chain resource a verification is for.
export type Resource =
  | { kind: "account"; accountId: string }
  | { kind: "note"; noteId: string };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Postgres returns every row it inserted, so no row means a broken insert.
const insertedId = ([row]: { id: string }[]) => {
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row.id;
};

// The package's row: inserted, or found when a concurrent verification of the
// same new package inserted it since the read outside the transaction.
const insertPackage = async (
  tx: Transaction,
  { name, files, entrypoint }: Project,
  build: VerifyResult,
) => {
  const [inserted] = await tx
    .insert(packagesTable)
    .values({
      name,
      type: build.kind,
      // Keeps the lockfile with the sources, so the record pins the
      // dependency versions that produced `commitment`.
      files: build.files ?? files,
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
  const verifiedAccount = await tx.query.verifiedAccountCodeTable.findFirst({
    columns: { id: true },
    where: { networkId, code },
  });
  const verifiedAccountId =
    verifiedAccount?.id ??
    insertedId(
      await tx
        .insert(verifiedAccountCodeTable)
        .values({ networkId, code })
        .returning({ id: verifiedAccountCodeTable.id }),
    );
  const component = await tx.query.verifiedAccountComponentTable.findFirst({
    columns: { id: true },
    where: { verifiedAccountId, packageCommitment },
  });
  if (component) {
    throw new HttpError(409, "account component already verified");
  }
  await tx
    .insert(verifiedAccountComponentTable)
    .values({ verifiedAccountId, packageId, packageCommitment, source });
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
  const verifiedNote = await tx.query.verifiedNoteScriptTable.findFirst({
    columns: { id: true },
    where: { networkId, script },
  });
  if (verifiedNote) {
    throw new HttpError(409, "note already verified");
  }
  await tx
    .insert(verifiedNoteScriptTable)
    .values({ networkId, script, source, packageId, packageCommitment });
};

/**
 * Verifies that `project` compiles to the resource's package on `networkId`
 * and, when it does, records it: the package with its artifact, and the
 * verified account component or verified note keyed on the resource's root.
 * Returns whether it verified. Throws a 409 `HttpError` when the root is
 * already verified: for an account, by this very package, since an account
 * code is made of several; for a note, at all, since a note's script root is
 * its package's commitment.
 */
export const verifyResource = async ({
  networkId,
  resource,
  project,
  source = "unknown",
  maspStore,
  apiCompile,
}: {
  networkId: string;
  resource: Resource;
  project: Project;
  source?: string;
  maspStore: MaspStore;
  apiCompile: ApiCompile;
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
  });
  if (!build.verified) {
    return false;
  }
  const { code: root } = await apiCompile.importResource({
    networkId,
    resourceId,
  });
  const { commitment } = build;
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
