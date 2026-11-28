import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COUNTER_CONTRACT_ID,
  COUNTER_NOTE_ID,
  editProjectFile,
  notes,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { procedureExportPaths } from "miden-source-code-verification-utils/manifest";
import { RUST_PROJECT_ERROR } from "miden-source-code-verification-utils/project";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.ts";
import { type ApiCompile, ApiCompileError } from "../src/lib/api-compile.ts";
import { fakeApiCompile } from "./fake-api-compile.ts";

// The fixtures, deployed by `pnpm generate-fixtures` from the projects in
// `examples`. The note depends on `../counter-contract`, so the projects are
// sent with `examples` as the root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");
const ENTRYPOINT = "counter-note";
const noteMasm = "counter-note/counter_note.masm";

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

// A second network, used to check that records don't leak across networks. Only
// ever passed to the script-keyed route, which is a pure database read — so no
// note has to exist on it.
const otherNetworkId = "mlcl";

const NOTE_SCRIPT = notes[COUNTER_NOTE_ID].code;

// A well-formed script root that is never verified in these tests, used to
// check that a script-keyed lookup which matches nothing yields a 404.
const UNVERIFIED_NOTE_SCRIPT = "0x1111111111111111111111111111111111111111111111111111111111111111";

const examples = () => readProjectFiles(examplesDir);

// Verifies the fixture note with `files`, the examples by default.
const verifyCounterNote = async (files?: Record<string, string>) =>
  apiV1.post(`/${networkId}/verified-notes`).send({
    noteId: COUNTER_NOTE_ID,
    files: files ?? (await examples()),
    entrypoint: ENTRYPOINT,
  });

describe("POST /:networkId/verified-notes", () => {
  it("rejects requests with no note ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing noteId");
  });

  it("rejects a files map with no miden-project.toml", async () => {
    const res = await verifyCounterNote({ [noteMasm]: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("rejects a Rust project", async () => {
    const res = await verifyCounterNote({
      ...(await examples()),
      "counter-note/Cargo.toml": '[package]\nname = "counter-note"\n',
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: RUST_PROJECT_ERROR });
  });

  it("doesn't verify a counter-note that doesn't build", async () => {
    const files = await examples();
    editProjectFile(files, noteMasm, (content) =>
      content.replace("increment_count", "increment_counts"),
    );

    const res = await verifyCounterNote(files);

    expect(res.status).toBe(400);
  });

  it("verifies a counter-note", async () => {
    const res = await verifyCounterNote();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a counter-note whose script is already in the registry", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await verifyCounterNote();
    expect(res2.status).toBe(409);
    expect(res2.body).toHaveProperty("error", "note already verified");
  });

  it("doesn't verify a counter-note if sources don't match", async () => {
    const files = await examples();
    editProjectFile(files, noteMasm, (content) => content.replace("push.1", "push.2"));

    const res = await verifyCounterNote(files);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-notes/:noteId", () => {
  it("returns 404 for a note absent from the registry", async () => {
    const res = await apiV1.get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID}`).send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified note", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1.get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID}`).send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", COUNTER_NOTE_ID);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package.name", ENTRYPOINT);
    expect(res2.body).toHaveProperty("package.type", "note");
    expect(res2.body.package.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res2.body).toHaveProperty("packageCommitment", res2.body.package.commitment);
    // The compiled package is served on its own, not inlined in the record.
    expect(res2.body.package).not.toHaveProperty("masp");
    // Whether each of its procedures is read-only, by export path.
    expect(Object.keys(res2.body.package.readOnly).sort()).toEqual(
      procedureExportPaths(res2.body.package.manifest).sort(),
    );
    expect(res2.body.package.parameters).toEqual({ "::counter_note::main": [] });

    const res3 = await apiV1
      .get(`/${networkId}/packages/masp/${res2.body.package.commitment}.masp`)
      .responseType("blob");

    expect(res3.status).toBe(200);
    expect(res3.headers["content-type"]).toBe("application/octet-stream");
    expect(res3.body.length).toBeGreaterThan(0);
  });
});

describe("GET /:networkId/verified-notes/script/:script", () => {
  it("returns a previously verified note, without an on-chain lookup", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1.get(`/${networkId}/verified-notes/script/${NOTE_SCRIPT}`).send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package.name", ENTRYPOINT);
    expect(res2.body).toHaveProperty("package.type", "note");
    // The record is keyed on the network it was verified against, so the
    // network comes back on it — but no note took part in the lookup, so there
    // is no id to echo, unlike the id-keyed endpoint.
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).not.toHaveProperty("noteId");
  });

  it("doesn't return a note verified on another network", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // The same script root, but a network it was never verified on. Script
    // roots are network-specific, so this must not resolve to the record above.
    const res2 = await apiV1.get(`/${otherNetworkId}/verified-notes/script/${NOTE_SCRIPT}`).send();

    expect(res2.status).toBe(404);
    expect(res2.body).toHaveProperty("error", "verified note not found");
  });

  it("matches a script case-insensitively", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/script/0x${NOTE_SCRIPT.slice(2).toUpperCase()}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
  });

  it("returns 404 for a script absent from the registry", async () => {
    const res1 = await verifyCounterNote();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // Well-formed, but not the script just verified. Note ids are the same
    // width as script roots, so a note id passed here lands on this path too.
    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/script/${UNVERIFIED_NOTE_SCRIPT}`)
      .send();

    expect(res2.status).toBe(404);
    expect(res2.body).toHaveProperty("error", "verified note not found");
  });

  it("rejects a script that isn't a 32-byte hex root", async () => {
    const res = await apiV1.get(`/${networkId}/verified-notes/script/0xdeadbeef`).send();

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid script");
  });
});

describe("GET /:networkId/verified-notes/:noteId with a faked import", () => {
  // In process, with an api-compile whose import answers as set: the other
  // tests query the running registry, whose api-compile is real.
  const appWhoseImport = (importResource: ApiCompile["importResource"]) =>
    request(createApp({ apiCompile: fakeApiCompile({ importResource }) }));
  const appWhoseImportFails = (error: ApiCompileError) =>
    appWhoseImport(() => Promise.reject(error));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 for a note api-compile didn't find", async () => {
    const app = appWhoseImportFails(new ApiCompileError("not found on the network", 404));
    const res = await app.get(`/v1/${networkId}/verified-notes/${COUNTER_NOTE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified note not found" });
  });

  it("returns 404 for an account's id, whatever its code", async () => {
    // The code is a verified note script, so the 404 comes from the import's
    // kind, not from a miss on the root.
    const res1 = await verifyCounterNote();
    expect(res1.body).toHaveProperty("verified", true);

    const app = appWhoseImport(async () => ({
      type: "account",
      code: NOTE_SCRIPT,
      standardAccountComponents: [],
      procedures: [],
    }));
    const res = await app.get(`/v1/${networkId}/verified-notes/${COUNTER_CONTRACT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified note not found" });
  });

  // A script root no record carries, made up.
  const unverifiedScript = `0x${"cd".repeat(32)}`;

  it("names a standard note", async () => {
    // Standard code is never verified, which the 404 says.
    const app = appWhoseImport(async () => ({
      type: "note",
      code: unverifiedScript,
      standardNote: "P2ID",
    }));
    const res = await app.get(`/v1/${networkId}/verified-notes/${COUNTER_NOTE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified note not found", standardNote: "P2ID" });
  });

  it("names nothing of an unverified custom note", async () => {
    const app = appWhoseImport(async () => ({
      type: "note",
      code: unverifiedScript,
      standardNote: null,
    }));
    const res = await app.get(`/v1/${networkId}/verified-notes/${COUNTER_NOTE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified note not found" });
  });

  it.each([
    [502, "rpc error: request timed out"],
    [504, "api-compile did not answer in time"],
  ])("passes an api-compile %i through", async (status, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWhoseImportFails(new ApiCompileError(error, status));
    const res = await app.get(`/v1/${networkId}/verified-notes/${COUNTER_NOTE_ID}`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
  });
});
