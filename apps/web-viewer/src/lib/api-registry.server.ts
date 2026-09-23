import { API_REGISTRY_URL } from "@/lib/constants.server";

// A compiled package in the registry, as far as the pages read it: its name and
// the sources it was compiled from, keyed by project-relative path. It also
// carries the compiled `.masp` (base64) and manifest, left untyped.
export type SourcePackage = {
  name: string;
  files: Record<string, string>;
};

// The registry's verified account record (see the api-docs OpenAPI spec): one
// component per verified package.
export type VerifiedAccount = {
  id: string;
  networkId: string;
  code: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  verifiedAccountComponents: { package: SourcePackage }[];
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
