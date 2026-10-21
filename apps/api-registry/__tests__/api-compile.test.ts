import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiCompileError,
  fetchApiCompile,
  sendApiCompileUnavailable,
} from "../src/lib/api-compile.js";
import { API_COMPILE_IMPORT_TIMEOUT_MS } from "../src/lib/constants.js";
import { importResource } from "../src/lib/import-resource.js";

const respondWith = (response: globalThis.Response) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );

const rejectWith = (error: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw error;
    }),
  );

// Never answers: rejects once the request's signal aborts, as fetch does.
const hang = () => {
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<globalThis.Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

// Records what a route answered.
const fakeRes = () => {
  const sent: {
    status?: number;
    headers: Record<string, string>;
    body?: unknown;
  } = { headers: {} };
  const res = {
    set(name: string, value: string) {
      sent.headers[name] = value;
      return res;
    },
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, sent };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchApiCompile", () => {
  it("returns the JSON body of a successful response", async () => {
    respondWith(Response.json({ type: "note", code: "0x01" }));
    await expect(fetchApiCompile("/mtst/import/0x01")).resolves.toEqual({
      type: "note",
      code: "0x01",
    });
  });

  it("carries the status, error and Retry-After of a failed response", async () => {
    respondWith(
      Response.json(
        { error: "too many requests in progress, retry later" },
        { status: 503, headers: { "Retry-After": "30" } },
      ),
    );
    const error = await catchError(fetchApiCompile("/verify"));
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 503,
      message: "too many requests in progress, retry later",
      retryAfter: "30",
    });
  });

  it("handles an error page that isn't JSON", async () => {
    respondWith(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await catchError(fetchApiCompile("/verify"));
    expect(error).toMatchObject({
      status: 502,
      message: "api-compile responded 502",
    });
  });

  it("reports a successful response that isn't JSON as a 502", async () => {
    respondWith(new Response("not json", { status: 200 }));
    const error = await catchError(fetchApiCompile("/verify"));
    expect(error).toMatchObject({ status: 502 });
  });

  it("reports an unreachable api-compile as a 502", async () => {
    rejectWith(new TypeError("fetch failed"));
    const error = await catchError(fetchApiCompile("/verify"));
    expect(error).toMatchObject({
      status: 502,
      message: "api-compile is unreachable: fetch failed",
    });
  });

  it("reports a request that timed out as a 504", async () => {
    hang();
    const error = await catchError(
      fetchApiCompile("/mtst/import/0x01", {
        signal: AbortSignal.timeout(10),
      }),
    );
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 504,
      message: "api-compile did not answer in time",
    });
  });
});

describe("importResource", () => {
  it("gives up on an import after the timeout, with a 504", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // Fake timers don't drive `AbortSignal.timeout`: shorten it instead.
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => timeout(10));
    const fetch = hang();
    const error = await catchError(
      importResource({ networkId: "mtst", resourceId: "0x01" }),
    );
    expect(error).toMatchObject({ status: 504 });
    expect(spy).toHaveBeenCalledWith(API_COMPILE_IMPORT_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/mtst\/import\/0x01$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("sendApiCompileUnavailable", () => {
  it("passes a 503 through with its Retry-After", () => {
    const { res, sent } = fakeRes();
    const error = new ApiCompileError("busy", 503, "30");
    expect(sendApiCompileUnavailable(res, error)).toBe(true);
    expect(sent).toEqual({
      status: 503,
      headers: { "Retry-After": "30" },
      body: { error: "busy" },
    });
  });

  it("passes a 504 through", () => {
    const { res, sent } = fakeRes();
    expect(
      sendApiCompileUnavailable(res, new ApiCompileError("slow", 504)),
    ).toBe(true);
    expect(sent.status).toBe(504);
  });

  it("leaves other failures to the route", () => {
    const { res, sent } = fakeRes();
    expect(
      sendApiCompileUnavailable(res, new ApiCompileError("bad build", 400)),
    ).toBe(false);
    expect(sendApiCompileUnavailable(res, new Error("db down"))).toBe(false);
    expect(sent.status).toBeUndefined();
  });
});
