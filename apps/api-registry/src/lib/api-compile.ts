import type { Request } from "express";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import type {
  Manifest,
  ReadOnlyProcedures,
  TargetType,
} from "miden-source-code-verification-utils/manifest";
import type { Project } from "miden-source-code-verification-utils/project";
import { API_COMPILE_IMPORT_TIMEOUT_MS } from "./constants.ts";

// A failed call to api-compile, answered with the status it answered and its
// `Retry-After`, so a client can tell a temporary outage (502–504) from a
// refused request (4xx). When api-compile could not be reached, or did not
// answer with JSON, the status is 502; when it did not answer before the call's
// timeout, 504.
export class ApiCompileError extends HttpError {
  constructor(message: string, status: number, retryAfter?: string) {
    super(status, message, {
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
  }
}

// A standard account component detected in an account's code by api-compile's
// `/import`, with the procedure roots it claims.
export type StandardAccountComponent = { name: string; procedures: string[] };

// What `/import` answers: the on-chain code of a resource, an account code root
// or a note script root, which the registry keys its records on. An account
// also comes back with its standard components and every procedure root in its
// code, which the id-keyed account lookup forwards as is.
export type ImportedResource =
  | {
      type: "account";
      code: string;
      standardAccountComponents: StandardAccountComponent[];
      procedures: string[];
    }
  | { type: "note"; code: string };

// api-compile's debug build of a package's sources: a dev-profile build whose
// debug info names call-trace frames. Its failure is an `error`, which never
// fails the verification it came with.
export type DebugBuild =
  | {
      masp: string;
      commitment: string;
      manifest: Manifest;
      cargoMidenVersion?: string;
    }
  | { error: string };

// What `/verify` answers when the project built: whether its package is the
// resource's on chain, and the package itself.
export type VerifyResult = {
  verified: boolean;
  masp: string;
  commitment: string;
  // The compiled package's own kind, stored as the package's type.
  kind: TargetType;
  manifest: Manifest;
  readOnly: ReadOnlyProcedures;
  // The sources plus the lockfile the build used. Absent from api-compile
  // versions that predate it.
  files?: Record<string, string>;
  // Absent from api-compile versions that predate it.
  cargoMidenVersion?: string;
  // Set when a debug build was requested.
  debug?: DebugBuild;
};

/**
 * The calls the registry makes to api-compile. `createHttpApiCompile` is the
 * one over HTTP, which `createApp` attaches to the app; in-process tests pass
 * a fake instead. Each call rejects with an `ApiCompileError` carrying
 * api-compile's status: 400 when the request can never succeed (a project
 * that doesn't build, a resource not on chain), 404 for an import of a
 * resource that doesn't exist, 502–504 when a retry may pass.
 */
export type ApiCompile = {
  /** Builds `project` and checks its package against the resource on chain. */
  verify(input: {
    project: Project;
    networkId: string;
    resourceId: string;
    /** Whether to build the debug variant too. */
    debug: boolean;
  }): Promise<VerifyResult>;
  /** Fetches the on-chain code of a resource. */
  importResource(input: {
    networkId: string;
    resourceId: string;
  }): Promise<ImportedResource>;
  /**
   * Rebuilds a stored package's sources in the dev profile, for the debug
   * build backfill. api-compile answers 409 when the release build no longer
   * has `expectedCommitment`.
   */
  compileDebug(input: {
    files: Record<string, string>;
    entrypoint: string;
    expectedCommitment: string;
  }): Promise<{ debug?: DebugBuild }>;
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: globalThis.Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // What an `AbortSignal.timeout` rejects with.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiCompileError("api-compile did not answer in time", 504);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiCompileError(`api-compile is unreachable: ${message}`, 502);
  }
  // Error pages from Cloudflare or the container runtime are not JSON.
  const data = (await response.json().catch(() => undefined)) as
    | { error?: string }
    | undefined;
  if (!response.ok) {
    throw new ApiCompileError(
      data?.error ?? `api-compile responded ${response.status}`,
      response.status,
      response.headers.get("Retry-After") ?? undefined,
    );
  }
  if (data === undefined) {
    throw new ApiCompileError("api-compile answered with invalid JSON", 502);
  }
  return data as T;
};

const postJson = <T>(url: string, body: unknown) =>
  fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** The {@link ApiCompile} served at `baseUrl`. */
export const createHttpApiCompile = (baseUrl: string): ApiCompile => ({
  verify: ({ project: { files, entrypoint }, networkId, resourceId, debug }) =>
    postJson<VerifyResult>(`${baseUrl}/verify`, {
      files,
      entrypoint,
      networkId,
      resourceId,
      debug,
    }),
  importResource: ({ networkId, resourceId }) =>
    fetchJson<ImportedResource>(
      `${baseUrl}/${networkId}/import/${resourceId}`,
      { signal: AbortSignal.timeout(API_COMPILE_IMPORT_TIMEOUT_MS) },
    ),
  compileDebug: (input) =>
    postJson<{ debug?: DebugBuild }>(`${baseUrl}/compile-debug`, input),
});

/** The api-compile `createApp` attached to the app handling `req`. */
export const getApiCompile = (req: Request): ApiCompile =>
  req.app.locals.apiCompile;
