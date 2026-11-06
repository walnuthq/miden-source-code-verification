import type { ImportedResource } from "miden-source-code-verification-utils/api-compile";
import type {
  Manifest,
  ReadOnlyProcedures,
  TargetType,
} from "miden-source-code-verification-utils/manifest";
import { MIDEN_CLIENT_CACHE_DIR, MIDEN_TOOL_TIMEOUT_MS } from "./constants.ts";
import { execFile } from "./utils.ts";

// The helper tools: the three Rust binaries built from `apps/api-compile/crates`
// and found on PATH, which api-compile runs for what Node can't do. Each prints
// its result as JSON when it exits 0 and writes the reason to stderr otherwise.
// Only this module runs one, so only it knows how they fail.

// What `miden-import` and `miden-verifier` exit with when the request can never
// succeed: the resource doesn't exist, the ID is invalid, or (for the verifier)
// the package can't be read. Any other failure (an RPC timeout, a store error)
// exits with 1 and may pass on a retry.
const REJECTED_EXIT_CODE = 2;

// What running a helper tool yields: its result, or why it failed.
export type ToolRun<T> =
  | { output: T }
  | {
      // The reason the tool wrote to stderr, without the "Error: " prefix
      // `anyhow` adds. When it didn't run to the end, what happened instead:
      // it timed out, couldn't be spawned, or exited 0 without its result.
      error: string;
      // It exited with `REJECTED_EXIT_CODE`: a retry can't pass.
      rejected: boolean;
    };

// The code a failed `execFile` exited with. Unset when the tool didn't exit on
// its own: it timed out, or couldn't be spawned.
const exitCodeOf = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "number"
    ? error.code
    : undefined;

// What a failed `execFile` captured on stderr, if anything.
const stderrOf = (error: unknown) =>
  typeof error === "object" && error !== null && "stderr" in error
    ? String(error.stderr).trim()
    : "";

const run = async <T>(
  name: string,
  args: string[],
  cwd?: string,
): Promise<ToolRun<T>> => {
  console.info([name, ...args].join(" "));
  let stdout: string;
  try {
    ({ stdout } = await execFile(name, args, {
      cwd,
      timeout: MIDEN_TOOL_TIMEOUT_MS,
    }));
  } catch (error) {
    // On a non-zero exit the reason is on stderr. A timeout or a spawn
    // failure has none, and the error's message says what happened.
    const reason =
      stderrOf(error) ||
      (error instanceof Error ? error.message : `${name} failed`);
    return {
      error: reason.replace(/^Error:\s*/, ""),
      rejected: exitCodeOf(error) === REJECTED_EXIT_CODE,
    };
  }
  // The tool prints its result whenever it exits 0, so anything else is a
  // broken run a retry may fix, not a result that says no.
  if (!stdout.trim()) {
    return { error: `${name} printed no result`, rejected: false };
  }
  try {
    return { output: JSON.parse(stdout) as T };
  } catch {
    return {
      error: `${name} printed something that isn't JSON`,
      rejected: false,
    };
  }
};

// What `miden-verifier` prints: the resource's kind and root (`code`), and what
// its code is made of. An account's `components` are the names of its standard
// components, plus `Custom(<commitment>)` for the package it was given when
// the account's code holds every procedure that package exports. A note's
// `script` is a standard note's name, or `Custom(<commitment>)` when the
// package's entrypoint is the note script.
export type MidenVerifierOutput =
  | { type: "account"; code: string; components: string[] }
  | { type: "note"; code: string; script: string };

// What `miden-package-metadata` prints: the package's commitment and kind, its
// manifest, and whether each exported procedure is read-only (the JSON
// `packages/utils/src/manifest.ts` documents).
export type PackageMetadata = {
  commitment: string;
  kind: TargetType;
  manifest: Manifest;
  readOnly?: ReadOnlyProcedures;
};

// `miden-import` and `miden-verifier` keep one client store per network under
// `MIDEN_CLIENT_CACHE_DIR`, their working directory, which must exist.

// The resource's root and, for an account, its procedures and the standard
// components among them, read from its network.
export const midenImport = ({
  networkId,
  resourceId,
}: {
  networkId: string;
  resourceId: string;
}) =>
  run<ImportedResource>(
    "miden-import",
    ["--network-id", networkId, "--resource-id", resourceId],
    MIDEN_CLIENT_CACHE_DIR,
  );

// The resource's root and what its code is made of, given the package at
// `maspPath`. The resource is read from its network, or from `resourcePath`, a
// file holding its serialized bytes, when given.
export const midenVerifier = ({
  networkId,
  resourceId,
  maspPath,
  resourcePath,
}: {
  networkId: string;
  resourceId: string;
  maspPath: string;
  resourcePath?: string;
}) =>
  run<MidenVerifierOutput>(
    "miden-verifier",
    [
      "--network-id",
      networkId,
      "--resource-id",
      resourceId,
      "--masp-path",
      maspPath,
      ...(resourcePath ? ["--resource-path", resourcePath] : []),
    ],
    MIDEN_CLIENT_CACHE_DIR,
  );

// The package at `maspPath`, read.
export const midenPackageMetadata = (maspPath: string) =>
  run<PackageMetadata>("miden-package-metadata", [maspPath]);
