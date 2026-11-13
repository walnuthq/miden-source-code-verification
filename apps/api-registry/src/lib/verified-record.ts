import type {
  Package,
  VerifiedAccount,
  VerifiedAccountById,
  VerifiedAccountComponent,
  VerifiedNote,
  VerifiedNoteById,
} from "miden-source-code-verification-utils/api-registry";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import db from "../db/index.ts";
import type {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "../db/schema.ts";
import { type ApiCompile, ApiCompileError } from "./api-compile.ts";
import type { Resource } from "./verify-resource.ts";

// The kind of a resource, which picks the table its verified record is in.
type Kind = Resource["kind"];

const notFound = (kind: Kind) =>
  new HttpError(
    404,
    kind === "account"
      ? "verified account not found"
      : "verified note not found",
  );

// The rows a lookup reads, with the relations it loads.
type PackageRow = typeof packagesTable.$inferSelect;
type ComponentRow = typeof verifiedAccountComponentTable.$inferSelect & {
  package: PackageRow;
};
type AccountRow = typeof verifiedAccountCodeTable.$inferSelect & {
  verifiedAccountComponents: ComponentRow[];
};
type NoteRow = typeof verifiedNoteScriptTable.$inferSelect & {
  package: PackageRow;
};

// What the registry answers for each row, field by field: the wire format is
// named in `miden-source-code-verification-utils/api-registry`, so a column
// added to a table reaches the wire only when it is added here too. Timestamps
// are written as `JSON.stringify` writes a `Date`.
const toPackage = (row: PackageRow): Package => ({
  id: row.id,
  name: row.name,
  type: row.type,
  files: row.files,
  commitment: row.commitment,
  manifest: row.manifest,
  entrypoint: row.entrypoint,
  builtWith: row.builtWith,
  debugCommitment: row.debugCommitment,
  debugBuiltWith: row.debugBuiltWith,
  readOnly: row.readOnly,
  schemas: row.schemas,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toVerifiedAccountComponent = (
  row: ComponentRow,
): VerifiedAccountComponent => ({
  id: row.id,
  verifiedAccountId: row.verifiedAccountId,
  packageId: row.packageId,
  packageCommitment: row.packageCommitment,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  package: toPackage(row.package),
  // Whether the simulator can name the component's call-trace frames, without
  // fetching its debug build first.
  debugPackage: row.package.debugCommitment
    ? { commitment: row.package.debugCommitment }
    : null,
});

const toVerifiedAccount = (row: AccountRow): VerifiedAccount => ({
  id: row.id,
  networkId: row.networkId,
  code: row.code,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  verifiedAccountComponents: row.verifiedAccountComponents.map(
    toVerifiedAccountComponent,
  ),
});

const toVerifiedNote = (row: NoteRow): VerifiedNote => ({
  id: row.id,
  networkId: row.networkId,
  script: row.script,
  source: row.source,
  packageId: row.packageId,
  packageCommitment: row.packageCommitment,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  package: toPackage(row.package),
});

// The verified account keyed on `code`, with each component and its package.
const readVerifiedAccount = async (
  networkId: string,
  code: string,
): Promise<VerifiedAccount> => {
  const row = await db.query.verifiedAccountCodeTable.findFirst({
    where: { networkId, code },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });
  if (!row) {
    throw notFound("account");
  }
  return toVerifiedAccount(row);
};

// The verified note keyed on `script`, with its package.
const readVerifiedNote = async (
  networkId: string,
  script: string,
): Promise<VerifiedNote> => {
  const row = await db.query.verifiedNoteScriptTable.findFirst({
    where: { networkId, script },
    with: { package: true },
  });
  if (!row) {
    throw notFound("note");
  }
  return toVerifiedNote(row);
};

/**
 * The verified record keyed on `root` for `networkId`: the verified account of
 * an account code root, or the verified note of a note script root. Throws a
 * 404 `HttpError` when there is none.
 */
export function findVerifiedRecordByRoot(input: {
  networkId: string;
  kind: "account";
  root: string;
}): Promise<VerifiedAccount>;
export function findVerifiedRecordByRoot(input: {
  networkId: string;
  kind: "note";
  root: string;
}): Promise<VerifiedNote>;
export function findVerifiedRecordByRoot({
  networkId,
  kind,
  root,
}: {
  networkId: string;
  kind: Kind;
  root: string;
}) {
  return kind === "account"
    ? readVerifiedAccount(networkId, root)
    : readVerifiedNote(networkId, root);
}

/**
 * The verified record of the resource with `resource`'s id on `networkId`,
 * found through api-compile's import of its on-chain code, with the id echoed
 * back and, for an account, the standard components and procedure roots the
 * import found in its code. Throws a 404 `HttpError` when api-compile finds no
 * such resource on the network, when the id is a resource of the other kind,
 * or when its root has no record: the registry has nothing for the id either
 * way. Any other failure of the import passes through, as it says nothing
 * about the registry.
 */
export function findVerifiedRecord(input: {
  networkId: string;
  resource: Extract<Resource, { kind: "account" }>;
  apiCompile: ApiCompile;
}): Promise<VerifiedAccountById>;
export function findVerifiedRecord(input: {
  networkId: string;
  resource: Extract<Resource, { kind: "note" }>;
  apiCompile: ApiCompile;
}): Promise<VerifiedNoteById>;
export async function findVerifiedRecord({
  networkId,
  resource,
  apiCompile,
}: {
  networkId: string;
  resource: Resource;
  apiCompile: ApiCompile;
}): Promise<VerifiedAccountById | VerifiedNoteById> {
  const resourceId =
    resource.kind === "account" ? resource.accountId : resource.noteId;
  const imported = await apiCompile
    .importResource({ networkId, resourceId })
    .catch((error: unknown) => {
      // Only a resource api-compile could not find on chain (an unknown or
      // invalid id) is a miss.
      if (error instanceof ApiCompileError && error.status === 404) {
        throw notFound(resource.kind);
      }
      throw error;
    });
  if (resource.kind === "account" && imported.type === "account") {
    const { code, standardAccountComponents, procedures } = imported;
    return {
      ...(await findVerifiedRecordByRoot({
        networkId,
        kind: "account",
        root: code,
      })),
      accountId: resource.accountId,
      standardAccountComponents,
      procedures,
    };
  }
  if (resource.kind === "note" && imported.type === "note") {
    return {
      ...(await findVerifiedRecordByRoot({
        networkId,
        kind: "note",
        root: imported.code,
      })),
      noteId: resource.noteId,
    };
  }
  // The other kind's id resolves too, but to a root no record of this kind
  // carries.
  throw notFound(resource.kind);
}
