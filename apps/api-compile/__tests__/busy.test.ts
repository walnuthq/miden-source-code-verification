import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { describe, expect, it, vi } from "vitest";
import compileRouter from "../src/routes/compile.ts";

// No slot and no queue: every build is refused before it starts, so this runs
// in-process without a toolchain.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  COMPILE_CONCURRENCY: 0,
  COMPILE_QUEUE_SIZE: 0,
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const counterContractDir = path.resolve(
  __dirname,
  "../examples/counter-contract/counter-contract",
);

describe("POST /compile when the queue is full", () => {
  const app = express()
    .use(express.json({ limit: "1mb" }))
    .use(compileRouter)
    .use(errorHandler);

  it("answers 503 with a Retry-After", async () => {
    const files = await readProjectFiles(counterContractDir);
    const res = await request(app).post("/compile").send({ files });

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.body).toEqual({
      error: "too many requests in progress, retry later",
    });
  });
});
