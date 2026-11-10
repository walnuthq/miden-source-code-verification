import { DrizzleQueryError, sql } from "drizzle-orm";
import express from "express";
import { request } from "miden-source-code-verification-test-utils";
import {
  errorHandler,
  HttpError,
} from "miden-source-code-verification-utils/http-errors";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/context.ts";
import {
  DatabaseConnectionError,
  hideQueryErrors,
} from "../src/lib/query-errors.ts";

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

// Port 1 is closed: the connection is refused at once, with no Postgres needed.
const unreachable = () =>
  createDb("postgres://registry:registry@127.0.0.1:1/registry");

describe("a failed database connection", () => {
  const db = unreachable();
  const connectionApp = express();
  connectionApp.get("/transaction", async () => {
    await db.transaction(async () => {});
  });
  connectionApp.get("/select", async () => {
    await db.execute(sql`select 1`);
  });
  connectionApp.use(hideQueryErrors);
  connectionApp.use(errorHandler);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("rejects a transaction with a DatabaseConnectionError", async () => {
    const callback = vi.fn(async () => {});

    const error = await db.transaction(callback).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DatabaseConnectionError);
    expect((error as DatabaseConnectionError).cause).toMatchObject({
      code: "ECONNREFUSED",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("answers a transaction's failure without the database address", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const res = await request(connectionApp).get("/transaction");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "database query failed" });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("ECONNREFUSED");
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ cause: expect.any(DatabaseConnectionError) }),
    );
  });

  it("hides a plain query's failure too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(connectionApp).get("/select");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "database query failed" });
  });
});
