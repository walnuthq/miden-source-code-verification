import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { describe, expect, it, vi } from "vitest";
import compileRouter from "../src/routes/compile.ts";
import { useFakeTool } from "./fake-tool.ts";

// A one-second deadline and a cargo that hangs: the request must be answered
// by the deadline, not by the subprocess timeout.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  COMPILE_DEADLINE_MS: 1_000,
  CARGO_TARGET_DIR: join(tmpdir(), "deadline-target"),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const counterContractDir = path.resolve(
  __dirname,
  "../examples/counter-contract/counter-contract",
);

describe("POST /compile when the build outlasts the deadline", () => {
  useFakeTool("cargo", "#!/bin/sh\nsleep 30\n");
  const app = express()
    .use(express.json({ limit: "1mb" }))
    .use(compileRouter)
    .use(errorHandler);

  it("answers 504 when the build outlasts the request's deadline", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const files = await readProjectFiles(counterContractDir);
    const res = await request(app).post("/compile").send({ files });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({
      error: "the build did not finish within 1s",
    });
  }, 15_000);
});
