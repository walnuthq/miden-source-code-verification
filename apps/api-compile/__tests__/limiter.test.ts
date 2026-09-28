import { describe, expect, it } from "vitest";
import { BusyError, createLimiter } from "../src/lib/limiter.js";

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("createLimiter", () => {
  it("runs tasks one at a time, in order", async () => {
    const limit = createLimiter({ concurrency: 1, queueSize: 8 });
    const first = deferred();
    const events: string[] = [];
    const a = limit(async () => {
      events.push("a start");
      await first.promise;
      events.push("a end");
    });
    const b = limit(async () => {
      events.push("b start");
    });
    await Promise.resolve();
    expect(events).toEqual(["a start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a start", "a end", "b start"]);
  });

  it("rejects with BusyError once the queue is full", async () => {
    const limit = createLimiter({ concurrency: 1, queueSize: 1 });
    const running = deferred();
    const a = limit(() => running.promise);
    const b = limit(async () => "b");
    await expect(limit(async () => "c")).rejects.toBeInstanceOf(BusyError);
    running.resolve();
    await a;
    await expect(b).resolves.toBe("b");
  });

  it("drops a waiting task whose signal aborts", async () => {
    const limit = createLimiter({ concurrency: 1, queueSize: 1 });
    const running = deferred();
    const a = limit(() => running.promise);
    const controller = new AbortController();
    let ran = false;
    const b = limit(async () => {
      ran = true;
    }, controller.signal);
    controller.abort();
    await expect(b).rejects.toThrow();
    // The aborted task freed its queue place.
    const c = limit(async () => "c");
    running.resolve();
    await a;
    await expect(c).resolves.toBe("c");
    expect(ran).toBe(false);
  });

  it("frees the slot when a task throws", async () => {
    const limit = createLimiter({ concurrency: 1, queueSize: 0 });
    await expect(
      limit(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });
});
