import { describe, expect, it } from "vitest";

import { formatUtcTimestamp } from "@/lib/timestamps";

describe("formatUtcTimestamp", () => {
  it("formats an afternoon time", () => {
    expect(formatUtcTimestamp("2026-09-04T12:30:23.000Z")).toBe(
      "Sep-04-2026 12:30:23 PM +UTC",
    );
  });

  it("formats midnight as 12 AM", () => {
    expect(formatUtcTimestamp("2026-01-09T00:05:07.999Z")).toBe(
      "Jan-09-2026 12:05:07 AM +UTC",
    );
  });

  it("reads the time in UTC whatever the offset given", () => {
    expect(formatUtcTimestamp("2026-12-31T23:59:59-02:00")).toBe(
      "Jan-01-2027 01:59:59 AM +UTC",
    );
  });
});
