import {
  fetchWhileBusy,
  type VerificationResponse,
} from "miden-source-code-verification-utils/api-registry";
import type { NetworkId } from "miden-source-code-verification-utils/networks";
import type { ResourceId } from "miden-source-code-verification-utils/resource-id";

// The web-verifier's registry client: one verification request, `POST
// /v1/{network}/verified-accounts` or `…/verified-notes`, and what came back.
// A refused request is an `error` message for the form, worded for the user
// when it is about the verifier rather than the submitted sources.

// A busy verifier answers 503 with `Retry-After`; the request is resent that
// many times before giving up with the busy message.
export const MAX_BUSY_RETRIES = 3;

// Messages for failures that aren't about the submitted sources.
const UNAVAILABLE_MESSAGES: Record<number, string> = {
  502: "The verifier could not reach the compiler. Please try again later.",
  503: "The verifier is busy. Please try again in a few minutes.",
  504: "The verifier took too long to answer. Please try again later.",
};

// The registry's collection for a resource kind, which is also the segment of
// the resource's page on the web-viewer.
export const resourceCollection = (kind: ResourceId["kind"]) =>
  kind === "note" ? "verified-notes" : "verified-accounts";

export type VerifyOutcome = VerificationResponse | { error: string };

// What the registry's error body says, when it is one.
const errorOf = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  "error" in data &&
  typeof data.error === "string"
    ? data.error
    : undefined;

// Verifies `resource` on `network` against the project in `files`, built from
// `entrypoint`, recorded as submitted by `source`. `wait` spends a busy
// verifier's `Retry-After` (the form counts it down). Throws only when the
// request itself fails (no network, a refused connection).
export async function verifyResource({
  registryUrl,
  network,
  resource,
  files,
  entrypoint,
  source,
  wait,
}: {
  registryUrl: string;
  network: NetworkId;
  resource: ResourceId;
  files: Record<string, string>;
  entrypoint: string;
  source: string;
  wait?: (seconds: number) => Promise<void>;
}): Promise<VerifyOutcome> {
  // The API expects `accountId` in canonical hex form, which is what
  // `parseResourceId` resolves an address to.
  const id =
    resource.kind === "note"
      ? { noteId: resource.noteId }
      : { accountId: resource.accountId };
  const response = await fetchWhileBusy(
    () =>
      fetch(
        `${registryUrl}/v1/${network}/${resourceCollection(resource.kind)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...id, files, entrypoint, source }),
        },
      ),
    { maxRetries: MAX_BUSY_RETRIES, wait },
  );
  // Error pages from a proxy in front of the verifier are not JSON.
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      error:
        UNAVAILABLE_MESSAGES[response.status] ??
        errorOf(data) ??
        `Request failed (${response.status})`,
    };
  }
  return {
    verified: Boolean((data as Partial<VerificationResponse> | null)?.verified),
  };
}
