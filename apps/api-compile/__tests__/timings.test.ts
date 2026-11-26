import { describe, expect, it } from "vitest";

import { serverTiming, type Timings, timed } from "../src/lib/timings.ts";

describe("timed", () => {
  it("returns the result and records the duration under the name", async () => {
    const timings: Timings = {};

    const result = await timed(timings, "assemble", async () => "built");

    expect(result).toBe("built");
    expect(Object.keys(timings)).toEqual(["assemble"]);
    expect(timings.assemble).toBeGreaterThanOrEqual(0);
  });

  it("adds up the parts that share a name", async () => {
    const timings: Timings = { assemble: 1000 };

    await timed(timings, "assemble", async () => undefined);

    expect(timings.assemble).toBeGreaterThanOrEqual(1000);
  });

  it("counts a part that throws, and rethrows", async () => {
    const timings: Timings = {};

    await expect(
      timed(timings, "tools", async () => {
        throw new Error("no project");
      }),
    ).rejects.toThrow("no project");
    expect(timings).toHaveProperty("tools");
  });

  it("runs without a record", async () => {
    expect(await timed(undefined, "assemble", async () => 1)).toBe(1);
  });
});

describe("serverTiming", () => {
  it("lists each part with its duration in whole ms, in order", () => {
    expect(serverTiming({ tools: 412.4, assemble: 630.5 })).toBe("tools;dur=412, assemble;dur=631");
  });

  it("is empty when nothing was timed", () => {
    expect(serverTiming({})).toBe("");
  });
});
