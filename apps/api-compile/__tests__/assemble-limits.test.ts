import express from "express";
import { request } from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { describe, expect, it, vi } from "vitest";
import compileRouter from "../src/routes/compile.ts";
import { useFakeTool } from "./fake-tool.ts";

// The MASM path in-process, with fake tools: its deadline, its queue, and
// what it answers from what the tools print. One slot, no queue, a one-second
// deadline.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  ASSEMBLE_DEADLINE_MS: 1_000,
  ASSEMBLE_CONCURRENCY: 1,
  ASSEMBLE_QUEUE_SIZE: 0,
}));

const app = express()
  .use(express.json({ limit: "1mb" }))
  .use(compileRouter)
  .use(errorHandler);

const project = {
  "miden-project.toml": '[package]\nname = "counter"\nversion = "0.1.0"\n',
  "counter.masm": "pub proc get_count\nend\n",
};

describe("POST /compile a MASM project when the assembler hangs", () => {
  useFakeTool("miden-assemble", "#!/bin/sh\nsleep 30\n");

  it("answers 504 by the deadline, and 503 to a build that finds the slot taken", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const start = Date.now();
    // `request` sends on `then`: start the first now.
    const first = request(app)
      .post("/compile")
      .send({ files: project })
      .then((res) => res);
    // Sent once the first holds the slot.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await request(app).post("/compile").send({ files: project });

    expect(second.status).toBe(503);
    expect(second.headers["retry-after"]).toBe("30");
    const res = await first;
    expect(res.status).toBe(504);
    expect(res.body).toEqual({
      error: "the build did not finish within 1s",
    });
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 15_000);
});

describe("POST /compile a MASM project's answer", () => {
  // Writes an empty package where it is told to, after checking that the
  // project's files are under the root it is given.
  useFakeTool(
    "miden-assemble",
    `#!/bin/sh
test -f "$1/$2/miden-project.toml" && test -f "$1/counter.masm" || exit 1
: > "$3"
echo '{"built":true,"builtWith":"miden-assembly 0.0.0","rendered":"","diagnostics":[]}'
`,
  );
  // Prints schemas a MASM package can't have, which the answer leaves out.
  useFakeTool(
    "miden-package-metadata",
    `#!/bin/sh
test "$2" = "--entrypoint-dir" || exit 1
echo '{"commitment":"0x01","kind":"account-component","manifest":{},"parameters":{},"storage":{"slots":[]},"noteStorage":{"fields":[]}}'
`,
  );

  it("answers the package and the report, without schemas", async () => {
    const res = await request(app)
      .post("/compile")
      .send({ files: project, masm: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      built: true,
      stdout: "",
      stderr: "",
      masp: "",
      commitment: "0x01",
      kind: "account-component",
      manifest: {},
      readOnly: {},
      callsForeign: {},
      parameters: {},
      files: project,
      diagnostics: [],
      builtWith: "miden-assembly 0.0.0",
    });
  });
});

describe("POST /compile a MASM project that doesn't build", () => {
  useFakeTool(
    "miden-assemble",
    `#!/bin/sh
printf '%s\\n' '{"built":false,"builtWith":"miden-assembly 0.0.0","rendered":"  x bad\\n","diagnostics":[{"severity":"error","message":"bad"}]}'
`,
  );

  it("answers 200 with the rendered report in stderr", async () => {
    const res = await request(app).post("/compile").send({ files: project });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      built: false,
      stdout: "",
      stderr: "  x bad\n",
      diagnostics: [{ severity: "error", message: "bad" }],
      builtWith: "miden-assembly 0.0.0",
    });
  });
});
