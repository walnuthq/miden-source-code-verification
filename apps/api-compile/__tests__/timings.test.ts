import { describe, expect, it } from "vitest";
import { serverTiming, type Timings, timed } from "../src/lib/timings.ts";

describe("timed", () => {
  it("returns the result and records the duration under the name", async () => {
    const timings: Timings = {};

    const result = await timed(timings, "cargo", async () => "built");

    expect(result).toBe("built");
    expect(Object.keys(timings)).toEqual(["cargo"]);
    expect(timings.cargo).toBeGreaterThanOrEqual(0);
  });

  it("adds up the parts that share a name", async () => {
    const timings: Timings = { cargo: 1000 };

    await timed(timings, "cargo", async () => undefined);

    expect(timings.cargo).toBeGreaterThanOrEqual(1000);
  });

  it("counts a part that throws, and rethrows", async () => {
    const timings: Timings = {};

    await expect(
      timed(timings, "layout", async () => {
        throw new Error("no cache");
      }),
    ).rejects.toThrow("no cache");
    expect(timings).toHaveProperty("layout");
  });

  it("runs without a record", async () => {
    expect(await timed(undefined, "cargo", async () => 1)).toBe(1);
  });
});

describe("serverTiming", () => {
  it("lists each part with its duration in whole ms, in order", () => {
    expect(serverTiming({ layout: 412.4, cargo: 630.5 })).toBe(
      "layout;dur=412, cargo;dur=631",
    );
  });

  it("is empty when nothing was timed", () => {
    expect(serverTiming({})).toBe("");
  });
});
