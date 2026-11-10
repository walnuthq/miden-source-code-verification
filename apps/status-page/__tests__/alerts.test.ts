import { describe, expect, it } from "vitest";

import { formatDuration, reasonToPost } from "../scripts/lib/alerts.ts";
import type {
  ServiceHealth,
  ServiceStatus,
  StatusSnapshot,
} from "../src/lib/types.ts";

const SINCE = "2026-11-10T00:00:00.000Z";
const hoursAfterSince = (hours: number, minutes = 0) =>
  new Date(
    new Date(SINCE).getTime() + (hours * 60 + minutes) * 60_000,
  ).toISOString();

const service = (
  health: ServiceHealth,
  previousHealth: ServiceHealth | null,
  since = SINCE,
): ServiceStatus => ({
  id: "api-compile",
  name: "api-compile",
  description: "",
  url: "https://example.com",
  health,
  previousHealth,
  since,
  previousSince: null,
  endpoints: [],
});

const snapshot = (
  checkedAt: string,
  previousCheckedAt: string | null,
): StatusSnapshot => ({ checkedAt, previousCheckedAt, services: [] });

describe("reasonToPost", () => {
  it("stays quiet about a healthy service with no previous health", () => {
    expect(
      reasonToPost(service("healthy", null), snapshot(SINCE, null)),
    ).toBeNull();
  });

  it("announces an unhealthy service with no previous health", () => {
    expect(
      reasonToPost(service("unhealthy", null), snapshot(SINCE, null)),
    ).toEqual({ kind: "first-sighting" });
  });

  it("announces a service going from healthy to unhealthy", () => {
    expect(
      reasonToPost(
        service("unhealthy", "healthy"),
        snapshot(SINCE, hoursAfterSince(-1)),
      ),
    ).toEqual({ kind: "changed" });
  });

  it("announces a service going from unhealthy to healthy", () => {
    expect(
      reasonToPost(
        service("healthy", "unhealthy"),
        snapshot(SINCE, hoursAfterSince(-1)),
      ),
    ).toEqual({ kind: "changed" });
  });

  it("stays quiet about a service that remains healthy", () => {
    expect(
      reasonToPost(
        service("healthy", "healthy"),
        snapshot(hoursAfterSince(1), SINCE),
      ),
    ).toBeNull();
  });

  it("stays quiet before an outage reaches its first 6 hours", () => {
    expect(
      reasonToPost(
        service("unhealthy", "unhealthy"),
        snapshot(hoursAfterSince(2), hoursAfterSince(1, 30)),
      ),
    ).toBeNull();
  });

  it("reminds when an outage crosses a 6-hour multiple", () => {
    expect(
      reasonToPost(
        service("unhealthy", "unhealthy"),
        snapshot(hoursAfterSince(6, 20), hoursAfterSince(5, 50)),
      ),
    ).toEqual({ kind: "reminder", downFor: "6h 20m" });
  });

  it("stays quiet between reminders once an outage is past 6 hours", () => {
    expect(
      reasonToPost(
        service("unhealthy", "unhealthy"),
        snapshot(hoursAfterSince(7), hoursAfterSince(6, 30)),
      ),
    ).toBeNull();
  });

  it("stays quiet about an ongoing outage with no previous check time", () => {
    expect(
      reasonToPost(
        service("unhealthy", "unhealthy"),
        snapshot(hoursAfterSince(6, 20), null),
      ),
    ).toBeNull();
  });

  it("stays quiet when since cannot be parsed", () => {
    expect(
      reasonToPost(
        service("unhealthy", "unhealthy", "not a date"),
        snapshot(hoursAfterSince(6, 20), hoursAfterSince(5, 50)),
      ),
    ).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats minutes alone", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("formats whole hours", () => {
    expect(formatDuration(6 * 60 * 60_000)).toBe("6h");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });
});
