import { describe, expect, it } from "vitest";

import {
  type ProbedService,
  rollUp,
  withHistory,
} from "../scripts/lib/history.ts";
import type {
  EndpointStatus,
  ServiceHealth,
  ServiceStatus,
  StatusSnapshot,
} from "../src/lib/types.ts";

const CHECKED_AT = "2026-11-10T12:00:00.000Z";
const EARLIER = "2026-11-09T08:00:00.000Z";
const BEFORE_THAT = "2026-11-08T08:00:00.000Z";

const endpoint = (health: EndpointStatus["health"]): EndpointStatus => ({
  id: "e",
  label: "GET /",
  health,
  httpStatus: health === "healthy" ? 200 : 500,
  responseTimeMs: 10,
  summary: null,
  payload: null,
  error: null,
});

const probed = (health: ServiceHealth): ProbedService => ({
  id: "api-compile",
  name: "api-compile",
  description: "",
  url: "https://example.com",
  health,
  endpoints: [],
});

const previousService = (
  health: ServiceHealth,
  since: string | undefined,
): ServiceStatus =>
  ({
    ...probed(health),
    previousHealth: null,
    since,
    previousSince: null,
  }) as ServiceStatus;

const snapshotOf = (service: ServiceStatus): StatusSnapshot => ({
  checkedAt: EARLIER,
  previousCheckedAt: null,
  services: [service],
});

describe("rollUp", () => {
  it("is healthy when every endpoint is healthy", () => {
    expect(rollUp([endpoint("healthy"), endpoint("healthy")])).toBe("healthy");
  });

  it("is unhealthy when no endpoint is healthy", () => {
    expect(rollUp([endpoint("unhealthy"), endpoint("unhealthy")])).toBe(
      "unhealthy",
    );
  });

  it("is degraded when only some endpoints are healthy", () => {
    expect(rollUp([endpoint("healthy"), endpoint("unhealthy")])).toBe(
      "degraded",
    );
  });
});

describe("withHistory", () => {
  it("starts the clock at this run when there is no previous snapshot", () => {
    expect(withHistory(probed("healthy"), null, CHECKED_AT)).toMatchObject({
      previousHealth: null,
      since: CHECKED_AT,
      previousSince: null,
    });
  });

  it("carries since over when the health is unchanged", () => {
    const previous = snapshotOf(previousService("healthy", EARLIER));
    expect(withHistory(probed("healthy"), previous, CHECKED_AT)).toMatchObject({
      previousHealth: "healthy",
      since: EARLIER,
    });
  });

  it("moves since to this run and keeps the old one when the health changed", () => {
    const previous = snapshotOf(previousService("unhealthy", BEFORE_THAT));
    expect(withHistory(probed("healthy"), previous, CHECKED_AT)).toMatchObject({
      previousHealth: "unhealthy",
      since: CHECKED_AT,
      previousSince: BEFORE_THAT,
    });
  });

  it("starts the clock at this run when the previous entry has no since", () => {
    const previous = snapshotOf(previousService("healthy", undefined));
    expect(withHistory(probed("healthy"), previous, CHECKED_AT)).toMatchObject({
      since: CHECKED_AT,
    });
  });
});
