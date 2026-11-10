import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiCompileError,
  createHttpApiCompile,
} from "../src/lib/api-compile.ts";
import {
  API_COMPILE_BUILD_TIMEOUT_MS,
  API_COMPILE_IMPORT_TIMEOUT_MS,
} from "../src/lib/constants.ts";

const apiCompile = createHttpApiCompile("http://api-compile");
const project = {
  files: { "Cargo.toml": "" },
  entrypoint: ".",
  name: "counter-contract",
};
const verify = () =>
  apiCompile.verify({
    project,
    networkId: "mtst",
    resourceId: "0x01",
    debug: true,
  });
const importResource = () =>
  apiCompile.importResource({ networkId: "mtst", resourceId: "0x01" });

const respondWith = (response: globalThis.Response) => {
  const fetch = vi.fn((_input: unknown, _init?: RequestInit) =>
    Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

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
    (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createHttpApiCompile", () => {
  it("returns the JSON body of a successful response", async () => {
    respondWith(Response.json({ type: "note", code: "0x01" }));
    await expect(importResource()).resolves.toEqual({
      type: "note",
      code: "0x01",
    });
  });

  it("posts the project, the resource and the debug flag to /verify", async () => {
    const fetch = respondWith(Response.json({ verified: false, root: "0x01" }));
    await verify();
    expect(fetch).toHaveBeenCalledWith(
      "http://api-compile/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      files: project.files,
      entrypoint: ".",
      networkId: "mtst",
      resourceId: "0x01",
      debug: true,
    });
  });

  it("keeps the abort signal out of the JSON bodies it posts", async () => {
    const controller = new AbortController();
    const fetch = respondWith(Response.json({ verified: false, root: "0x01" }));
    await apiCompile.verify({
      project,
      networkId: "mtst",
      resourceId: "0x01",
      debug: true,
      signal: controller.signal,
    });
    expect(
      JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)),
    ).not.toHaveProperty("signal");
    fetch.mockImplementation(() => Promise.resolve(Response.json({})));
    await apiCompile.compileDebug({
      files: {},
      entrypoint: ".",
      expectedCommitment: "0x01",
      signal: controller.signal,
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      files: {},
      entrypoint: ".",
      expectedCommitment: "0x01",
    });
  });

  it("returns what /verify answers", async () => {
    respondWith(Response.json({ verified: true, root: "0x01" }));
    await expect(verify()).resolves.toEqual({ verified: true, root: "0x01" });
  });

  // What an api-compile from before `root` answers, as the one still serving
  // during its rollout.
  it("reports a /verify answer with no root as a 502", async () => {
    respondWith(Response.json({ verified: true }));
    const error = await catchError(verify());
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 502,
      message: "api-compile answered with no resource root",
    });
  });

  it("carries the status, error and Retry-After of a failed response", async () => {
    respondWith(
      Response.json(
        { error: "too many requests in progress, retry later" },
        { status: 503, headers: { "Retry-After": "30" } },
      ),
    );
    const error = await catchError(verify());
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 503,
      message: "too many requests in progress, retry later",
      headers: { "Retry-After": "30" },
    });
  });

  it("handles an error page that isn't JSON", async () => {
    respondWith(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await catchError(verify());
    expect(error).toMatchObject({
      status: 502,
      message: "api-compile responded 502",
    });
  });

  it("reports a successful response that isn't JSON as a 502", async () => {
    respondWith(new Response("not json", { status: 200 }));
    const error = await catchError(verify());
    expect(error).toMatchObject({ status: 502 });
  });

  it("reports an unreachable api-compile as a 502", async () => {
    rejectWith(new TypeError("fetch failed"));
    const error = await catchError(verify());
    expect(error).toMatchObject({
      status: 502,
      message: "api-compile is unreachable: fetch failed",
    });
  });

  it("gives up on an import after the timeout, with a 504", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // Fake timers don't drive `AbortSignal.timeout`: shorten it instead.
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => timeout(10));
    const fetch = hang();
    const error = await catchError(importResource());
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 504,
      message: "api-compile did not answer in time",
    });
    expect(spy).toHaveBeenCalledWith(API_COMPILE_IMPORT_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledWith(
      "http://api-compile/mtst/import/0x01",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("gives up on a verification after the timeout, with a 504", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => timeout(10));
    hang();
    const error = await catchError(verify());
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 504,
      message: "api-compile did not answer in time",
    });
    expect(spy).toHaveBeenCalledWith(API_COMPILE_BUILD_TIMEOUT_MS);
  });

  it("gives up on a debug build after the timeout, with a 504", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => timeout(10));
    hang();
    const error = await catchError(
      apiCompile.compileDebug({
        files: {},
        entrypoint: ".",
        expectedCommitment: "0x01",
      }),
    );
    expect(error).toBeInstanceOf(ApiCompileError);
    expect(error).toMatchObject({
      status: 504,
      message: "api-compile did not answer in time",
    });
    expect(spy).toHaveBeenCalledWith(API_COMPILE_BUILD_TIMEOUT_MS);
  });

  it("stops a verification when its signal aborts", async () => {
    hang();
    const controller = new AbortController();
    const pending = catchError(
      apiCompile.verify({
        project,
        networkId: "mtst",
        resourceId: "0x01",
        debug: true,
        signal: controller.signal,
      }),
    );
    controller.abort();
    expect(await pending).toBeInstanceOf(ApiCompileError);
  });
});
