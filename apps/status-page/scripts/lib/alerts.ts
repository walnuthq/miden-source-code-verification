import type { ServiceStatus, StatusSnapshot } from "../../src/lib/types.ts";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** "1h 30m", "45m", "6h" — outage durations, not precise timings. */
export const formatDuration = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
};

export type Reason =
  | { kind: "changed" }
  | { kind: "first-sighting" }
  | { kind: "reminder"; downFor: string };

/**
 * The state machine, expressed as a pure function so every branch is reachable
 * from a hand-written snapshot in testing.
 *
 * Reminders are *derived* rather than stored: crossing a 6-hour boundary
 * measured from `since` is what makes one due. Nothing is persisted, so a lost
 * or failed deploy cannot desynchronise the cadence — the next run recomputes
 * it from the same two timestamps.
 */
export const reasonToPost = (
  service: ServiceStatus,
  snapshot: StatusSnapshot,
): Reason | null => {
  const { health, previousHealth, since } = service;

  if (previousHealth === null) {
    // No previous snapshot: the first deploy, or a fetch that failed. Announce
    // a bad state (it is news to the channel) and stay quiet about a good one.
    return health === "healthy" ? null : { kind: "first-sighting" };
  }

  if (previousHealth !== health) return { kind: "changed" };
  if (health === "healthy") return null;

  // Unchanged and still bad — a reminder is due only when this run is the first
  // one past a 6-hour multiple of the outage.
  const { checkedAt, previousCheckedAt } = snapshot;
  if (!previousCheckedAt) return null;
  const start = new Date(since).getTime();
  const now = new Date(checkedAt).getTime();
  const before = new Date(previousCheckedAt).getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(now) ||
    !Number.isFinite(before)
  ) {
    return null;
  }
  const crossed =
    Math.floor((now - start) / SIX_HOURS_MS) >
    Math.floor((before - start) / SIX_HOURS_MS);
  return crossed
    ? { kind: "reminder", downFor: formatDuration(now - start) }
    : null;
};
