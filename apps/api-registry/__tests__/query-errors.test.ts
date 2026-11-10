import { DrizzleQueryError } from "drizzle-orm";
import express from "express";
import { request } from "miden-source-code-verification-test-utils";
import {
  errorHandler,
  HttpError,
} from "miden-source-code-verification-utils/http-errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hideQueryErrors } from "../src/lib/query-errors.ts";

const queryError = new DrizzleQueryError(
  "select * from packages where id = $1",
  ["secret-param"],
  new Error("connection refused"),
);

const app = express();
app.get("/query", () => {
  throw queryError;
});
app.get("/plain", () => {
  throw new Error("masp store unavailable");
});
app.get("/http", () => {
  throw new HttpError(409, "note already verified");
});
app.use(hideQueryErrors);
app.use(errorHandler);

describe("hideQueryErrors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a failed query without its SQL and parameters, and logs it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const res = await request(app).get("/query");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "database query failed" });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("select");
    expect(text).not.toContain("secret-param");
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ cause: queryError }),
    );
  });

  it("keeps the message of any other error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/plain");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "masp store unavailable" });
  });

  it("keeps the status of an HttpError", async () => {
    const res = await request(app).get("/http");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "note already verified" });
  });
});
