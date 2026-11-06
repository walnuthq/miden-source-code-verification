import type { StandardAccountComponent } from "./api-compile.ts";
import type { Manifest, ReadOnlyProcedures, TargetType } from "./manifest.ts";

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
  // From the project's `Cargo.toml`.
  name: string;
  type: TargetType;
  // The sources plus the lockfile the build used, keyed by project-relative
  // path: the exact inputs behind `commitment`.
  files: Record<string, string>;
  commitment: string;
  manifest: Manifest;
  // The project directory within `files` the package was built from (`.` for
  // the root). Null for packages recorded before it was stored.
  entrypoint: string | null;
  // The cargo-miden that built it, when known.
  builtWith: string | null;
  // The debug build of the same sources: its own commitment, served at
  // `packageMaspPath(…, "debug")`, and the cargo-miden that built it. Null
  // until it has one.
  debugCommitment: string | null;
  debugBuiltWith: string | null;
  // Whether each exported procedure is read-only, by export path.
  readOnly: ReadOnlyProcedures;
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
  // The package's debug build, whose debug info names call-trace frames, or
  // null when it has none: known without fetching the build first.
  debugPackage: { commitment: string } | null;
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

// `POST /v1/{networkId}/verified-accounts` and `…/verified-notes`: whether the
// project's package is the resource's on chain. A refused request (a project
// that doesn't build, a resource not on the network, a root already verified
// by it) is an error status, not `false`.
export type VerificationResponse = { verified: boolean };

// ─── MASP artifact ──────────────────────────────────────────────────────────

// Which build of a package an artifact is: the `release` build that verified,
// or the `debug` build of the same sources, whose debug info names call-trace
// frames. Both are keyed by the release build's commitment.
export type MaspVariant = "release" | "debug";

// The key of a package's artifact, e.g. `0xd4ae…9d.masp`, or
// `0xd4ae…9d.debug.masp` for its debug build: the object key the registry
// stores it under and the file name it serves it at (`packageMaspPath`),
// which `parseMaspKey` reads back.
export const maspKey = (commitment: string, variant: MaspVariant = "release") =>
  `${commitment.toLowerCase()}${variant === "debug" ? ".debug" : ""}.masp`;

const MASP_KEY_PATTERN = /^(0x[0-9a-f]{64})(\.debug)?\.masp$/i;

// The inverse of `maspKey`: `null` when `key` isn't one.
export const parseMaspKey = (
  key: string,
): { commitment: string; variant: MaspVariant } | null => {
  const match = MASP_KEY_PATTERN.exec(key);
  if (!match?.[1]) {
    return null;
  }
  return {
    commitment: match[1].toLowerCase(),
    variant: match[2] ? "debug" : "release",
  };
};

// The name a package's artifact is downloaded as, e.g. `counter_contract.masp`
// for `counter-contract` or `counter_contract.debug.masp` for its debug build:
// the package name as Rust spells the crate, which is how cargo-miden names the
// artifact and what the simulator's `miden-client call --package` line uses.
// Each run of characters outside `[A-Za-z0-9.]` becomes `_`, then leading `_`
// are dropped, so WIT-style names (`miden:basic-wallet/basic-wallet`) work too.
// When nothing is left of the name, the artifact's key. The registry sends it
// as the `Content-Disposition` of the artifact, and the web-viewer shows it.
export const maspDownloadName = (
  name: string,
  commitment: string,
  variant: MaspVariant = "release",
) => {
  const base = name.replace(/[^A-Za-z0-9.]+/g, "_").replace(/^_+/, "");
  return base
    ? `${base}${variant === "debug" ? ".debug" : ""}.masp`
    : maspKey(commitment, variant);
};

// The registry's path to a package's artifact, for `networkId`.
export const packageMaspPath = (
  networkId: string,
  commitment: string,
  variant: MaspVariant = "release",
) => `/v1/${networkId}/packages/masp/${maspKey(commitment, variant)}`;

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
  {
    maxRetries,
    wait = sleep,
  }: { maxRetries: number; wait?: (seconds: number) => Promise<void> },
): Promise<Response> {
  let response = await request();
  for (let retry = 1; response.status === 503 && retry <= maxRetries; retry++) {
    await wait(retryAfterSeconds(response.headers.get("Retry-After")));
    response = await request();
  }
  return response;
}
