import type { StandardAccountComponent } from "./api-compile.ts";
import type { Manifest, ProcedureParameters, ReadOnlyProcedures, TargetType } from "./manifest.ts";

// What api-registry answers, how it names a package's artifact, and how a
// client waits out its 503. The registry's lookups build their answers against
// these types and its clients (the web-viewer, the web-verifier, the status
// probe) read them: one place names the wire format, so no client mirrors the
// registry's rows by hand. The OpenAPI block at the top of
// `apps/api-registry/src/app.ts` spells the same shapes under the same names,
// for the docs.

// ─── Verified records ───────────────────────────────────────────────────────

// A package as the registry stores and serves it: the sources it was built
// from and what api-compile read of the build. Timestamps are ISO 8601.
export type Package = {
  id: string;
  // The `[package] name` of the project's `miden-project.toml`.
  name: string;
  type: TargetType;
  // The sources, keyed by project-relative path: the exact inputs behind
  // `commitment`.
  files: Record<string, string>;
  commitment: string;
  manifest: Manifest;
  // The project directory within `files` the package was built from (`.` for
  // the root). Null for packages recorded before it was stored.
  entrypoint: string | null;
  // The versions the assembler that built it was built with, when known
  // (`miden-assembly 0.36.5, miden-protocol 0.18.0`).
  builtWith: string | null;
  // Whether each exported procedure is read-only, by export path.
  readOnly: ReadOnlyProcedures;
  // Each exported procedure's parameter names and types, by export path, from
  // the MASM source (see `ProcedureParameters` in `manifest.ts`).
  parameters: ProcedureParameters;
  createdAt: string;
  updatedAt: string;
};

// One of the packages a verified account's code is made of, with the package.
export type VerifiedAccountComponent = {
  id: string;
  verifiedAccountId: string;
  packageId: string;
  packageCommitment: string;
  // The client that verified it (e.g. `miden-verify`), `unknown` by default.
  source: string;
  // When the package was verified against this code, which can be later than
  // the package was first stored.
  createdAt: string;
  updatedAt: string;
  package: Package;
};

// `GET /v1/{networkId}/verified-accounts/code/{code}`: the verified account
// keyed on `networkId` and `code`, with every component of the code.
export type VerifiedAccount = {
  id: string;
  networkId: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  verifiedAccountComponents: VerifiedAccountComponent[];
};

// `GET /v1/{networkId}/verified-accounts/{accountId}`: the same record, found
// through the account's on-chain code, with the id echoed back and what the
// import read of the code: its standard components and every procedure root.
export type VerifiedAccountById = VerifiedAccount & {
  accountId: string;
  standardAccountComponents: StandardAccountComponent[];
  procedures: string[];
};

// `GET /v1/{networkId}/verified-notes/script/{script}`: the verified note
// keyed on `networkId` and `script`, with its package.
export type VerifiedNote = {
  id: string;
  networkId: string;
  script: string;
  source: string;
  packageId: string;
  packageCommitment: string;
  createdAt: string;
  updatedAt: string;
  package: Package;
};

// `GET /v1/{networkId}/verified-notes/{noteId}`: the same record, found
// through the note's on-chain script, with the id echoed back.
export type VerifiedNoteById = VerifiedNote & { noteId: string };

// What the 404 of `GET /v1/{networkId}/verified-accounts/{accountId}` or
// `…/verified-notes/{noteId}` adds to its `error` when the resource is
// standard code, which is never verified: an account whose every procedure
// belongs to a standard component, with the components' names, or a standard
// note, with its name.
export type StandardResource = { standardAccountComponents: string[] } | { standardNote: string };

// `POST /v1/{networkId}/verified-accounts` and `…/verified-notes`: whether the
// project's package is the resource's on chain. A refused request (a project
// that doesn't build, a resource not on the network, a root already verified
// by it) is an error status, not `false`.
export type VerificationResponse = { verified: boolean };

// ─── MASP artifact ──────────────────────────────────────────────────────────

// The key of a package's artifact, e.g. `0xd4ae…9d.masp`: the object key the
// registry stores it under and the file name it serves it at
// (`packageMaspPath`), which `parseMaspKey` reads back. The artifact is the
// package api-compile assembled, debug info included.
export const maspKey = (commitment: string) => `${commitment.toLowerCase()}.masp`;

const MASP_KEY_PATTERN = /^(0x[0-9a-f]{64})\.masp$/i;

// The inverse of `maspKey`, the commitment in lower case: `null` when `key`
// isn't one.
export const parseMaspKey = (key: string): string | null =>
  MASP_KEY_PATTERN.exec(key)?.[1]?.toLowerCase() ?? null;

// The name a package's artifact is downloaded as, e.g. `counter_contract.masp`
// for `counter-contract`: each run of characters outside `[A-Za-z0-9.]`
// becomes `_`, then leading `_` are dropped. When nothing is left of the name,
// the artifact's key. The registry sends it as the `Content-Disposition` of
// the artifact, and the web-viewer shows it.
export const maspDownloadName = (name: string, commitment: string) => {
  const base = name.replace(/[^A-Za-z0-9.]+/g, "_").replace(/^_+/, "");
  return base ? `${base}.masp` : maspKey(commitment);
};

// The registry's path to a package's artifact, for `networkId`.
export const packageMaspPath = (networkId: string, commitment: string) =>
  `/v1/${networkId}/packages/masp/${maspKey(commitment)}`;

// ─── A busy registry ────────────────────────────────────────────────────────

// A registry whose compiler is busy answers 503 and passes its `Retry-After`
// through: the seconds to wait before sending the same request again. Read
// within bounds, so a missing or odd header waits half a minute and a long one
// no more than two.
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const MAX_RETRY_AFTER_SECONDS = 120;

export const retryAfterSeconds = (header: string | null) => {
  const seconds = Number(header);
  if (header === null || !Number.isFinite(seconds) || seconds < 1) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
};

const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

// Sends `request()` and, while the answer is a 503, waits its `Retry-After`
// (`retryAfterSeconds`) and sends it again, up to `maxRetries` more times;
// answers the last response, a 503 included. `wait` is how the caller spends
// the wait (the web-verifier counts it down, a script logs it) and resolves
// when it is over; by default it sleeps.
export async function fetchWhileBusy(
  request: () => Promise<Response>,
  { maxRetries, wait = sleep }: { maxRetries: number; wait?: (seconds: number) => Promise<void> },
): Promise<Response> {
  let response = await request();
  for (let retry = 1; response.status === 503 && retry <= maxRetries; retry++) {
    await wait(retryAfterSeconds(response.headers.get("Retry-After")));
    response = await request();
  }
  return response;
}
