import type {
  StandardResource,
  VerifiedAccountById,
  VerifiedNoteById,
} from "miden-source-code-verification-utils/api-registry";
import type {
  Dependency,
  FunctionType,
  ProcedureExport,
} from "miden-source-code-verification-utils/manifest";
import type { ResourceId } from "miden-source-code-verification-utils/resource-id";
import { data } from "react-router";

import { API_REGISTRY_TIMEOUT_MS, API_REGISTRY_URL } from "@/lib/constants.server";

// The records the pages read are the registry's own wire types
// (`miden-source-code-verification-utils/api-registry`). Only the manifest is
// narrowed here, to what the pure functions read of it, so their tests can
// build one without the rest of a `Manifest`.

// Only what the pages read of the shared `Manifest`: each exported procedure's
// path, digest and signature (its calling convention, `abi`, and its types),
// for the verification status and the package's procedures, and the packages
// it was compiled against. Picked
// from the shared types so they can't drift from what the registry serves.
export type PackageManifest = {
  // `Procedure` is optional as a manifest also exports constants and types,
  // named so the full `Manifest` assigns to the view.
  exports: {
    Procedure?: Pick<ProcedureExport, "path" | "digest"> & {
      signature: FunctionType | null;
    };
    Constant?: unknown;
    Type?: unknown;
  }[];
  dependencies: PackageDependency[];
};

export type PackageDependency = Pick<Dependency, "name" | "version" | "digest">;

const unavailable = (status: number) =>
  data(null, {
    status,
    statusText:
      "The verification status could not be checked right now. Please try again in a minute.",
  });

// A timeout, whether while waiting for the answer or while reading its body,
// is a 504; any other failure to get the answer is a 502.
const unavailableAfter = (error: unknown) =>
  unavailable(error instanceof Error && error.name === "TimeoutError" ? 504 : 502);

// What the registry answers for a resource: its verified record, or, when it
// answers 404, that it has none, which includes ids that don't resolve
// on-chain, and whether the resource is standard code, which is never verified.
export type Lookup<T> = { record: T } | { record: null; standard: StandardResource | null };

// What a 404's body says of standard code, when it says anything the page can
// show.
const standardOf = (body: unknown): StandardResource | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { standardAccountComponents, standardNote } = body as Record<string, unknown>;
  if (
    Array.isArray(standardAccountComponents) &&
    standardAccountComponents.every((name) => typeof name === "string")
  ) {
    return { standardAccountComponents };
  }
  return typeof standardNote === "string" ? { standardNote } : null;
};

// A 502–504 means it
// couldn't look the resource up (its compiler, or the node, failed), which the
// error page reports as temporary rather than as an unexpected error. A
// registry that can't be reached, takes too long or answers something that
// isn't JSON is reported the same way.
async function getVerifiedResource<T>(path: string): Promise<Lookup<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_REGISTRY_URL}${path}`, {
      signal: AbortSignal.timeout(API_REGISTRY_TIMEOUT_MS),
    });
  } catch (error) {
    throw unavailableAfter(error);
  }
  if (response.status === 404) {
    // An unreadable body only loses what it would have said.
    const body: unknown = await response.json().catch(() => null);
    return { record: null, standard: standardOf(body) };
  }
  if (response.status >= 502 && response.status <= 504) {
    throw unavailable(response.status);
  }
  if (!response.ok) {
    throw new Error(`api-registry responded ${response.status} for ${path}`);
  }
  const record = (await response.json().catch((error: unknown) => {
    throw unavailableAfter(error);
  })) as T;
  return { record };
}

// The verified record for a resource on a network, by its on-chain id: the
// registry's `GET /v1/{networkId}/verified-accounts/{accountId}` or
// `…/verified-notes/{noteId}`, whose answer the kind decides.
export function getVerifiedRecord(lookup: {
  networkId: string;
  resource: Extract<ResourceId, { kind: "account" }>;
}): Promise<Lookup<VerifiedAccountById>>;
export function getVerifiedRecord(lookup: {
  networkId: string;
  resource: Extract<ResourceId, { kind: "note" }>;
}): Promise<Lookup<VerifiedNoteById>>;
export function getVerifiedRecord({
  networkId,
  resource,
}: {
  networkId: string;
  resource: ResourceId;
}): Promise<Lookup<VerifiedAccountById> | Lookup<VerifiedNoteById>> {
  const collection =
    resource.kind === "account"
      ? `verified-accounts/${encodeURIComponent(resource.accountId)}`
      : `verified-notes/${encodeURIComponent(resource.noteId)}`;
  return getVerifiedResource(`/v1/${encodeURIComponent(networkId)}/${collection}`);
}
