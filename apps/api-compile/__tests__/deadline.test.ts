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

describe("POST /compile when the tools after the build outlast the deadline", () => {
  // The build succeeds at once and leaves the .masp where buildProject reads
  // it; the version answers; anything else (locate-project) hangs.
  useFakeTool(
    "cargo",
    `#!/bin/sh
case "$1 $2" in
  "miden build") mkdir -p "$MIDENC_TARGET_DIR/release" && : > "$MIDENC_TARGET_DIR/release/counter-contract.masp" ;;
  "miden --version") echo "cargo-miden 0.0.0" ;;
  *) sleep 30 ;;
esac
`,
  );
  useFakeTool("miden-package-metadata", "#!/bin/sh\nsleep 30\n");
  const app = express()
    .use(express.json({ limit: "1mb" }))
    .use(compileRouter)
    .use(errorHandler);

  it("answers 504 within the deadline when the tools after the build hang", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const files = await readProjectFiles(counterContractDir);
    const start = Date.now();
    const res = await request(app).post("/compile").send({ files });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({
      error: "the build did not finish within 1s",
    });
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 45_000);
});
