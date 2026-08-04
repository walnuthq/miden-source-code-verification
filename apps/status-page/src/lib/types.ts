/** Outcome of a single endpoint check. */
export type CheckHealth = "healthy" | "unhealthy";

/**
 * Rolled up across a service's checks. `degraded` matters because some checks
 * depend on things outside the service — `POST /verify` reaches the Miden
 * testnet — so one failing check must not read the same as the service being
 * down.
 */
export type ServiceHealth = "healthy" | "degraded" | "unhealthy";

/** A handful of fields lifted out of a response too large to render whole. */
export type CheckSummary = Record<string, string | number | boolean>;

export type EndpointStatus = {
  id: string;
  /** Human-readable request line, e.g. `POST /compile`. */
  label: string;
  health: CheckHealth;
  /** null when the request never got a response (DNS failure, timeout, …). */
  httpStatus: number | null;
  responseTimeMs: number;
  /** Set when the response is too big to show in full. */
  summary: CheckSummary | null;
  /** Full parsed body — only for responses small enough to render verbatim. */
  payload: unknown;
  error: string | null;
};

export type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  url: string;
  health: ServiceHealth;
  endpoints: EndpointStatus[];
};

export type StatusSnapshot = {
  /** ISO 8601, when the probe ran. */
  checkedAt: string;
  services: ServiceStatus[];
};
