import type { StandardResource } from "miden-source-code-verification-utils/api-registry";

// The data of the "not verified" 404 page: whether the resource is standard
// code, which is never verified, as the registry's 404 said. Null on a network
// the registry doesn't serve, and for a resource that isn't standard code.
export type NotVerifiedPage = { standard: StandardResource | null };

// The standard code a "not verified" 404's data names, if any: the data of
// any other error response is something else.
export const standardOf404 = (data: unknown): StandardResource | null =>
  typeof data === "object" && data !== null && "standard" in data
    ? ((data as NotVerifiedPage).standard ?? null)
    : null;
