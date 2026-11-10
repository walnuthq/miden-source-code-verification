import type {
  EndpointStatus,
  ServiceHealth,
  ServiceStatus,
  StatusSnapshot,
} from "../../src/lib/types.ts";

export const rollUp = (endpoints: EndpointStatus[]): ServiceHealth => {
  const healthy = endpoints.filter(
    (endpoint) => endpoint.health === "healthy",
  ).length;
  if (healthy === endpoints.length) return "healthy";
  return healthy === 0 ? "unhealthy" : "degraded";
};

/** Everything a probe can know on its own — the history is added afterwards. */
export type ProbedService = Omit<
  ServiceStatus,
  "previousHealth" | "since" | "previousSince"
>;

/**
 * Carries the outage clock forward: `since` only moves when the health changes,
 * so it marks the start of the current state rather than the time of this run.
 */
export const withHistory = (
  service: ProbedService,
  previous: StatusSnapshot | null,
  checkedAt: string,
): ServiceStatus => {
  const before = previous?.services.find(({ id }) => id === service.id);
  // `before` is parsed from a published file that may predate these fields —
  // the first run after this ships reads a snapshot with no `since` at all — so
  // it is treated as untrusted rather than as a ServiceStatus.
  const unchanged = before !== undefined && before.health === service.health;
  return {
    ...service,
    previousHealth: before?.health ?? null,
    since: unchanged && before.since ? before.since : checkedAt,
    // The start of the state being left, kept because `since` is about to stop
    // describing it. Without this a recovery can only measure from its own
    // timestamp, which is always zero.
    previousSince: before?.since ?? null,
  };
};
