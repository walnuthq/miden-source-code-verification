import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { errorHandler, HttpError, notFound } from "../src/http-errors.ts";

// An app whose routes fail in every way the handler tells apart.
const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/busy", () => {
  throw new HttpError(503, "too many requests in progress, retry later", {
    headers: { "Retry-After": "30" },
  });
});
app.get("/rejected", async () => {
  throw new HttpError(400, "invalid code");
});
app.get("/failed", async () => {
  throw new Error("db down");
});
app.get("/thrown-value", () => {
  throw "nope";
});
app.get("/status-code", () => {
  throw Object.assign(new Error("upstream failed"), { statusCode: 502 });
});
app.get("/not-an-error-status", () => {
  throw Object.assign(new Error("odd"), { status: 200 });
});
// Fails once the client is gone, as an aborted build does.
let gone: express.Response | undefined;
app.get("/gone", async (_req, res) => {
  gone = res;
  await new Promise((_resolve, reject) => {
    res.on("close", () => reject(new Error("cargo miden was cancelled")));
  });
});
app.post("/echo", (req, res) => {
  res.json(req.body);
});
app.use(notFound);
app.use(errorHandler);

const server = createServer(app);
let url: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const silenceErrors = () =>
  vi.spyOn(console, "error").mockImplementation(() => {});

describe("errorHandler", () => {
  it("answers an HttpError with its status, headers and message", async () => {
    const error = silenceErrors();
    const res = await fetch(`${url}/busy`);

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    await expect(res.json()).resolves.toEqual({
      error: "too many requests in progress, retry later",
    });
    expect(error).toHaveBeenCalledOnce();
  });

  it("doesn't log a 4xx", async () => {
    const error = silenceErrors();
    const res = await fetch(`${url}/rejected`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid code" });
    expect(error).not.toHaveBeenCalled();
  });

  it("answers 500 with the message of an error without a status, and logs it", async () => {
    const error = silenceErrors();
    const res = await fetch(`${url}/failed`);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "db down" });
    expect(error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("answers 500 for a thrown value that isn't an Error", async () => {
    const error = silenceErrors();
    const res = await fetch(`${url}/thrown-value`);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "internal error" });
    expect(error).toHaveBeenCalledWith("nope");
  });

  it("reads statusCode too, as express.json's errors spell it", async () => {
    silenceErrors();
    const res = await fetch(`${url}/status-code`);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "upstream failed" });
  });

  it("answers 500 for a status that isn't an error status", async () => {
    silenceErrors();
    const res = await fetch(`${url}/not-an-error-status`);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "odd" });
  });

  it("answers nothing, and logs nothing, once the client is gone", async () => {
    const error = silenceErrors();
    gone = undefined;
    const req = get(`${url}/gone`);
    req.on("error", () => {});
    await vi.waitFor(() => expect(gone).toBeDefined());
    const closed = new Promise((resolve) => gone?.once("close", resolve));
    req.destroy();
    await closed;
    // The rejection reaches the handler a tick after the close.
    await new Promise((resolve) => setImmediate(resolve));

    expect(gone?.headersSent).toBe(false);
    expect(gone?.writableEnded).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it("answers JSON for a body that isn't valid JSON", async () => {
    const res = await fetch(`${url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"files":',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "request body is not valid JSON",
    });
  });

  it("answers JSON for a body over the limit", async () => {
    const res = await fetch(`${url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: "x".repeat(1_100_000) }),
    });

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: "request body is larger than 1 MB",
    });
  });
});

describe("notFound", () => {
  it("answers JSON for an unknown path", async () => {
    const res = await fetch(`${url}/nope`);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not found" });
  });
});
