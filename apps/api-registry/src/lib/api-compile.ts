import { HttpError } from "miden-source-code-verification-utils/http-errors";
import { API_COMPILE_URL } from "./constants.ts";

// A failed call to api-compile, answered with the status it answered and its
// `Retry-After`, so a client can tell a temporary outage (502–504) from a
// refused request (4xx). When api-compile could not be reached, or did not
// answer with JSON, the status is 502; when it did not answer before
// `init.signal` timed out, 504.
export class ApiCompileError extends HttpError {
  constructor(message: string, status: number, retryAfter?: string) {
    super(status, message, {
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
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
