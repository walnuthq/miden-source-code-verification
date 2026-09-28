import type { Response } from "express";
import { API_COMPILE_URL } from "@/lib/constants.js";

// A failed call to api-compile, with the status it answered. When it could not
// be reached, or did not answer with JSON, the status is 502.
export class ApiCompileError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

export const fetchApiCompile = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  let response: globalThis.Response;
  try {
    response = await fetch(`${API_COMPILE_URL}${path}`, init);
  } catch (error) {
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

// When api-compile was unreachable (502), busy (503) or too slow (504), answer
// with the same status and its `Retry-After`, so a client can tell a temporary
// outage from a failed verification. Returns whether it answered.
export const sendApiCompileUnavailable = (res: Response, error: unknown) => {
  if (
    !(error instanceof ApiCompileError) ||
    error.status < 502 ||
    error.status > 504
  ) {
    return false;
  }
  if (error.retryAfter) {
    res.set("Retry-After", error.retryAfter);
  }
  res.status(error.status).json({ error: error.message });
  return true;
};
