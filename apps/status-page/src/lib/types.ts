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
  /**
   * Health at the previous probe, or null when no previous snapshot could be
   * read. Carried forward so scripts/notify.ts can tell a state change from a
   * continuing outage without any state of its own.
   */
  previousHealth: ServiceHealth | null;
  /** ISO 8601 — when the service entered its current health. */
  since: string;
  /**
   * ISO 8601 — when the service entered the health it has just left, or null
   * when there was no previous snapshot (or one written before this field
   * existed). `since` moves to this run whenever the health changes, so it
   * cannot measure the state being left; this is what a recovery message needs
   * to say how long the outage lasted.
   */
  previousSince: string | null;
  endpoints: EndpointStatus[];
};

export type StatusSnapshot = {
  /** ISO 8601, when the probe ran. */
  checkedAt: string;
  /**
   * `checkedAt` of the snapshot this run carried state forward from, or null
   * when there was none. Together with each service's `since` it is what lets
   * the reminder cadence be derived rather than stored.
   */
  previousCheckedAt: string | null;
  services: ServiceStatus[];
};
