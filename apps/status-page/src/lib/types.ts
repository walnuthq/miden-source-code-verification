/** How a service's root endpoint is interpreted. */
export type ServiceKind =
  /** `/` returns JSON we render in full (the two API services). */
  | "json"
  /** `/` serves something else (HTML); only reachability is checked. */
  | "liveness";

export type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  url: string;
  kind: ServiceKind;
  healthy: boolean;
  /** null when the request never got a response (DNS failure, timeout, …). */
  httpStatus: number | null;
  responseTimeMs: number;
  /** Parsed response body — only ever set for `kind: "json"`. */
  payload: unknown;
  error: string | null;
};

export type StatusSnapshot = {
  /** ISO 8601, when the probe ran. */
  checkedAt: string;
  services: ServiceStatus[];
};
