import type { Request } from "express";
import type {
  CompileDebugResponse,
  ImportedResource,
  VerifyResponse,
} from "miden-source-code-verification-utils/api-compile";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import type { Project } from "miden-source-code-verification-utils/project";
import {
  API_COMPILE_BUILD_TIMEOUT_MS,
  API_COMPILE_IMPORT_TIMEOUT_MS,
} from "./constants.ts";

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

/**
 * The calls the registry makes to api-compile, answering what it answers (the
 * types in `miden-source-code-verification-utils/api-compile`).
 * `createHttpApiCompile` is the one over HTTP, which `createApp` attaches to
 * the app; in-process tests pass a fake instead. Each call rejects with an
 * `ApiCompileError` carrying api-compile's status: 400 when the request can
 * never succeed (a project that doesn't build, a resource not on chain), 404
 * for an import of a resource that doesn't exist, 502–504 when a retry may
 * pass.
 */
export type ApiCompile = {
  /**
   * Builds `project` and checks its package against the resource on chain,
   * answering the resource's root with the result.
   */
  verify(input: {
    project: Project;
    networkId: string;
    resourceId: string;
    /** Whether to build the debug variant too. */
    debug: boolean;
    /** Aborts the call, as when the registry's own client went away. */
    signal?: AbortSignal;
  }): Promise<VerifyResponse>;
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
    /** Aborts the call, as when the registry's own client went away. */
    signal?: AbortSignal;
  }): Promise<CompileDebugResponse>;
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

const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(API_COMPILE_BUILD_TIMEOUT_MS);
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
};

/** The {@link ApiCompile} served at `baseUrl`. */
export const createHttpApiCompile = (baseUrl: string): ApiCompile => ({
  verify: async ({
    project: { files, entrypoint },
    networkId,
    resourceId,
    debug,
    signal,
  }) => {
    const response = await postJson<VerifyResponse>(
      `${baseUrl}/verify`,
      { files, entrypoint, networkId, resourceId, debug },
      signal,
    );
    // An api-compile from before `root` was answered, as the one still
    // serving during its rollout: without the root there is nothing to key a
    // record on, and the next request may reach the new one.
    if (typeof response.root !== "string") {
      throw new ApiCompileError(
        "api-compile answered with no resource root",
        502,
      );
    }
    return response;
  },
  importResource: ({ networkId, resourceId }) =>
    fetchJson<ImportedResource>(
      `${baseUrl}/${networkId}/import/${resourceId}`,
      { signal: AbortSignal.timeout(API_COMPILE_IMPORT_TIMEOUT_MS) },
    ),
  compileDebug: ({ signal, ...input }) =>
    postJson<CompileDebugResponse>(`${baseUrl}/compile-debug`, input, signal),
});

/** The api-compile `createApp` attached to the app handling `req`. */
export const getApiCompile = (req: Request): ApiCompile =>
  req.app.locals.apiCompile;
