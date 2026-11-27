import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COUNTER_CONTRACT_ID,
  editProjectFile,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { RUST_PROJECT_ERROR } from "miden-source-code-verification-utils/project";
import { describe, expect, it } from "vitest";

// `/compile` and `/verify`: `miden-assemble` in the compose stack's image, on
// the examples. The examples sit side by side, as the projects of one root:
// the note depends on the counter by path.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const masmExamplesDir = path.resolve(__dirname, "../examples");
const counterMasm = "counter-contract/counter_contract.masm";

const api = request(process.env.API_URL ?? "http://localhost:8080");

// Every example, keyed by its path under `examples`.
const masmExamples = () => readProjectFiles(masmExamplesDir);

// What an answer no longer has: the keys of a Rust project's.
const cargoOnlyKeys = ["storage", "noteStorage", "masm", "debug", "cargoMidenVersion"];

describe("POST /compile a MASM project", () => {
  it("builds the counter, with its package and no diagnostics", async () => {
    const files = await masmExamples();
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      built: true,
      stdout: "",
      stderr: "",
      diagnostics: [],
      kind: "account-component",
      readOnly: {
        "::counter_contract::get_count": true,
        "::counter_contract::increment_count": false,
      },
      callsForeign: {
        "::counter_contract::get_count": false,
        "::counter_contract::increment_count": false,
      },
      parameters: {
        "::counter_contract::get_count": [],
        "::counter_contract::increment_count": [{ name: "amount", type: "felt" }],
      },
    });
    expect(res.body.masp).toEqual(expect.any(String));
    expect(res.body.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.builtWith).toMatch(/^miden-assembly 0\.36\.\d+, miden-protocol 0\.18\.\d+$/);
    // The project as sent: there is no lockfile to add.
    expect(res.body.files).toEqual(files);
    for (const key of cargoOnlyKeys) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it("ignores masm, warmLockfile and debug", async () => {
    const files = await masmExamples();
    const plain = await api.post("/compile").send({ files, entrypoint: "counter-contract" });
    const flagged = await api.post("/compile").send({
      files,
      entrypoint: "counter-contract",
      masm: true,
      warmLockfile: true,
      debug: true,
    });

    expect(flagged.status).toBe(200);
    // The package too: its debug info names the sources by their path in
    // the project, not under the build's own directory.
    expect(flagged.body).toEqual(plain.body);
  });

  it("builds a note with a path dependency on the counter", async () => {
    const files = await masmExamples();
    const res = await api.post("/compile").send({ files, entrypoint: "counter-note" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      built: true,
      kind: "note",
      diagnostics: [],
      parameters: { "::counter_note::main": [] },
    });
    // The counter procedure it calls: `increment_count`.
    expect(res.body.accountProcedures).toEqual([expect.any(String)]);
  });

  it("builds a project at the root", async () => {
    const files = await readProjectFiles(`${masmExamplesDir}/counter-contract`);
    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("kind", "account-component");
  });

  it("doesn't build a typo, and says where it is", async () => {
    const files = await masmExamples();
    editProjectFile(files, counterMasm, (content) =>
      content.replace("movup.4 add", "movup.4 addd"),
    );
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ built: false, stdout: "" });
    expect(res.body.builtWith).toEqual(expect.any(String));
    const [error, ...others] = res.body.diagnostics;
    expect(others).toEqual([]);
    expect(error).toMatchObject({
      severity: "error",
      file: counterMasm,
      line: 25,
      column: 13,
      length: 4,
    });
    // The rendered report names the file relative to the project root, and
    // nothing of the server's directories.
    expect(res.body.stderr).toContain(counterMasm);
    expect(res.body.stderr).not.toContain("/work/");
    for (const key of ["masp", "commitment", "kind", "manifest", "files"]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it("builds with a warning, returned with its span and rendered", async () => {
    const files = await masmExamples();
    editProjectFile(files, counterMasm, (content) =>
      content.replace("use miden::core::sys\n", "use miden::core::sys\nuse miden::core::word\n"),
    );
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: "unused import",
        file: counterMasm,
        line: 4,
      }),
    ]);
    expect(res.body.stderr).toContain("unused import");
  });

  it("refuses a dependency path that leaves the project, as a failed build", async () => {
    const files = await readProjectFiles(`${masmExamplesDir}/counter-note`);
    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", false);
    expect(res.body.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        file: "miden-project.toml",
      }),
    ]);
  });

  it("takes a project with a stray Cargo.lock but no Cargo.toml", async () => {
    const files = {
      ...(await readProjectFiles(`${masmExamplesDir}/counter-contract`)),
      "Cargo.lock": "# not a cargo project\n",
    };
    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body.files).toEqual(files);
  });

  it("reports where the time went in Server-Timing", async () => {
    const files = await masmExamples();
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(200);
    const parts = (res.headers["server-timing"] ?? "")
      .split(", ")
      .map((part) => part.split(";")[0]);
    expect(parts).toEqual(["assemble", "tools", "cleanup"]);
  });
});

describe("POST /compile refuses a files map that isn't a MASM project", () => {
  it("refuses a Rust project: a Cargo.toml at the entrypoint", async () => {
    const files = {
      ...(await masmExamples()),
      "counter-contract/Cargo.toml": '[package]\nname = "counter-contract"\n',
    };
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: RUST_PROJECT_ERROR });
  });

  it("wants a miden-project.toml at the entrypoint", async () => {
    const files = await masmExamples();
    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "missing miden-project.toml" });
  });

  it("refuses a miden-project.toml that isn't TOML", async () => {
    const files = await masmExamples();
    editProjectFile(files, "counter-contract/miden-project.toml", (content) =>
      content.replace("[package]", "[package"),
    );
    const res = await api.post("/compile").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "counter-contract/miden-project.toml is not valid TOML",
    });
  });

  it("refuses a miden-project.toml with no [package]", async () => {
    const res = await api.post("/compile").send({
      files: { "miden-project.toml": '[workspace]\nmembers = ["a"]\n' },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "miden-project.toml has no [package]",
    });
  });
});

describe("POST /verify a MASM project", () => {
  it("answers the failed build's report as a 400", async () => {
    const files = await masmExamples();
    editProjectFile(files, counterMasm, (content) =>
      content.replace("movup.4 add", "movup.4 addd"),
    );
    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId: "mtst",
      resourceId: COUNTER_CONTRACT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(counterMasm);
  });

  // The counter isn't the code of Mainnet's public USDCx fee faucet: the
  // answer is the verifier's no, with the package and the assembler's report.
  it("doesn't verify the counter against an account with other code", async () => {
    const files = await masmExamples();
    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId: "mm",
      resourceId: "0xe69e6ca6e39df1b10c1e5399399feb",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      verified: false,
      kind: "account-component",
      diagnostics: [],
    });
    expect(res.body.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.builtWith).toEqual(expect.any(String));
    expect(res.body.files).toEqual(files);
    for (const key of cargoOnlyKeys) {
      expect(res.body).not.toHaveProperty(key);
    }
  });
});
