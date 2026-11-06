import { HttpError } from "miden-source-code-verification-utils/http-errors";
import db from "../db/index.ts";
import {
  type ApiCompile,
  ApiCompileError,
  type StandardAccountComponent,
} from "./api-compile.ts";
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

// The verified account keyed on `code`, with each component and its package.
const readVerifiedAccount = async (networkId: string, code: string) => {
  const verifiedAccount = await db.query.verifiedAccountCodeTable.findFirst({
    where: { networkId, code },
    with: { verifiedAccountComponents: { with: { package: true } } },
  });
  if (!verifiedAccount) {
    throw notFound("account");
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

// The verified note keyed on `script`, with its package.
const readVerifiedNote = async (networkId: string, script: string) => {
  const verifiedNote = await db.query.verifiedNoteScriptTable.findFirst({
    where: { networkId, script },
    with: { package: true },
  });
  if (!verifiedNote) {
    throw notFound("note");
  }
  return verifiedNote;
};

type VerifiedAccount = Awaited<ReturnType<typeof readVerifiedAccount>>;
type VerifiedNote = Awaited<ReturnType<typeof readVerifiedNote>>;

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
}): Promise<
  VerifiedAccount & {
    accountId: string;
    standardAccountComponents: StandardAccountComponent[];
    procedures: string[];
  }
>;
export function findVerifiedRecord(input: {
  networkId: string;
  resource: Extract<Resource, { kind: "note" }>;
  apiCompile: ApiCompile;
}): Promise<VerifiedNote & { noteId: string }>;
export async function findVerifiedRecord({
  networkId,
  resource,
  apiCompile,
}: {
  networkId: string;
  resource: Resource;
  apiCompile: ApiCompile;
}) {
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
