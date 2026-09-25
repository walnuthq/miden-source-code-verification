import type {
  Dependency,
  FunctionType,
  ProcedureExport,
} from "miden-source-code-verification-utils/manifest";

import { API_REGISTRY_URL } from "@/lib/constants.server";

// A compiled package in the registry, as far as the pages read it: its name,
// digest, the sources it was compiled from, keyed by project-relative path, and
// the procedures its manifest exports. It also carries the compiled `.masp`
// (base64), left untyped.
export type SourcePackage = {
  name: string;
  digest: string;
  files: Record<string, string>;
  manifest: PackageManifest;
};

// Only what the pages read of the shared `Manifest`: each exported procedure's
// path, digest and calling convention (`abi`), for the verification status and
// the package's procedures, and the packages it was compiled against. Picked
// from the shared types so they can't drift from what the registry serves.
export type PackageManifest = {
  // `Procedure` is optional as a manifest also exports constants and types.
  exports: {
    Procedure?: Pick<ProcedureExport, "path" | "digest"> & {
      signature: Pick<FunctionType, "abi"> | null;
    };
  }[];
  dependencies: PackageDependency[];
};

export type PackageDependency = Pick<Dependency, "name" | "version" | "digest">;

// A standard component detected in an account's code, with the procedure roots
// it accounts for.
export type StandardAccountComponent = { name: string; procedures: string[] };

// The registry's verified account record (see the api-docs OpenAPI spec): one
// component per verified package.
export type VerifiedAccount = {
  id: string;
  networkId: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  // `createdAt` is when the component was verified against this code, which
  // can be later than its package was first stored.
  verifiedAccountComponents: {
    source: string;
    createdAt: string;
    package: SourcePackage;
  }[];
  standardAccountComponents: StandardAccountComponent[];
  // Every procedure root in the account's code.
  procedures: string[];
};

// The registry's verified note record (see the api-docs OpenAPI spec), with the
// package the note was verified against.
export type VerifiedNote = {
  id: string;
  networkId: string;
  script: string;
  source: string;
  packageId: string;
  packageDigest: string;
  createdAt: string;
  updatedAt: string;
  noteId: string;
  package: SourcePackage;
};

// `null` when the registry answers 404: it has no verified record for the
// resource, which includes ids that don't resolve on-chain.
async function getVerifiedResource<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_REGISTRY_URL}${path}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`api-registry responded ${response.status} for ${path}`);
  }
  return response.json();
}

export function getVerifiedAccount({
  networkId,
  accountId,
}: {
  networkId: string;
  accountId: string;
}) {
  return getVerifiedResource<VerifiedAccount>(
    `/v1/${encodeURIComponent(networkId)}/verified-accounts/${encodeURIComponent(accountId)}`,
  );
}

export function getVerifiedNote({
  networkId,
  noteId,
}: {
  networkId: string;
  noteId: string;
}) {
  return getVerifiedResource<VerifiedNote>(
    `/v1/${encodeURIComponent(networkId)}/verified-notes/${encodeURIComponent(noteId)}`,
  );
}
