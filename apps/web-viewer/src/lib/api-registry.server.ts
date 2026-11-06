import type {
  VerifiedAccountById,
  VerifiedNoteById,
} from "miden-source-code-verification-utils/api-registry";
import type {
  Dependency,
  FunctionType,
  ProcedureExport,
} from "miden-source-code-verification-utils/manifest";
import { data } from "react-router";

import { API_REGISTRY_URL } from "@/lib/constants.server";

// The records the pages read are the registry's own wire types
// (`miden-source-code-verification-utils/api-registry`). Only the manifest is
// narrowed here, to what the pure functions read of it, so their tests can
// build one without the rest of a `Manifest`.

// Only what the pages read of the shared `Manifest`: each exported procedure's
// path, digest and calling convention (`abi`), for the verification status and
// the package's procedures, and the packages it was compiled against. Picked
// from the shared types so they can't drift from what the registry serves.
export type PackageManifest = {
  // `Procedure` is optional as a manifest also exports constants and types,
  // named so the full `Manifest` assigns to the view.
  exports: {
    Procedure?: Pick<ProcedureExport, "path" | "digest"> & {
      signature: Pick<FunctionType, "abi"> | null;
    };
    Constant?: unknown;
    Type?: unknown;
  }[];
  dependencies: PackageDependency[];
};

export type PackageDependency = Pick<Dependency, "name" | "version" | "digest">;

// `null` when the registry answers 404: it has no verified record for the
// resource, which includes ids that don't resolve on-chain. A 502–504 means it
// couldn't look the resource up (its compiler, or the node, failed), which the
// error page reports as temporary rather than as an unexpected error.
async function getVerifiedResource<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_REGISTRY_URL}${path}`);
  if (response.status === 404) {
    return null;
  }
  if (response.status >= 502 && response.status <= 504) {
    throw data(null, {
      status: response.status,
      statusText:
        "The verification status could not be checked right now. Please try again in a minute.",
    });
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
  return getVerifiedResource<VerifiedAccountById>(
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
  return getVerifiedResource<VerifiedNoteById>(
    `/v1/${encodeURIComponent(networkId)}/verified-notes/${encodeURIComponent(noteId)}`,
  );
}
