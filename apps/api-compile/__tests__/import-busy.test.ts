import express from "express";
import { request } from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { describe, expect, it, vi } from "vitest";
import importRouter from "../src/routes/import.ts";

// No slot and no queue: every import is refused before anything runs, so this
// runs in-process without the helper tools.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  IMPORT_CONCURRENCY: 0,
  IMPORT_QUEUE_SIZE: 0,
}));

describe("GET /:networkId/import/:resourceId when the queue is full", () => {
  const app = express().use(importRouter).use(errorHandler);

  it("answers 503 with a Retry-After", async () => {
    const res = await request(app).get("/mtst/import/0x01");

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.body).toEqual({
      error: "too many requests in progress, retry later",
    });
  });
});
