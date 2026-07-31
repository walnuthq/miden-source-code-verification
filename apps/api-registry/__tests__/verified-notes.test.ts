import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  COUNTER_NOTE_ID_1,
  COUNTER_NOTE_ID_2,
  notes,
} from "../../api-compile/__tests__/data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = "mtst";

// All three are counter-note instances that share the same note script, so
// they resolve to the same `script` in the registry. This is what lets a
// verification of one satisfy a lookup of another.
const NOTE_SCRIPT = notes[COUNTER_NOTE_ID_1].code;

describe("POST /:networkId/verified-notes", () => {
  it("rejects requests with no note ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing noteId");
  });

  it("rejects requests with no files object", async () => {
    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: COUNTER_NOTE_ID_1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(counterContractDir);
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: COUNTER_NOTE_ID_1,
      files: {
        "counter-note/src/lib.rs": files["counter-note/src/lib.rs"],
      },
      entrypoint: "counter-note",
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(counterContractDir);
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: COUNTER_NOTE_ID_1,
      files: {
        "counter-note/src/lib.rs": files["counter-note/src/lib.rs"],
        "counter-note/Cargo.toml": files["counter-note/Cargo.toml"],
      },
      entrypoint: "counter-note",
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't verify a buggy counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("CounterContract", "CounterAccount");

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: COUNTER_NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(500);
  });

  it("verifies a counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: COUNTER_NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a counter-note whose script is already in the registry", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    // First note registers the script.
    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: COUNTER_NOTE_ID_1, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // A different note sharing the same script is already covered.
    const res2 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: COUNTER_NOTE_ID_2, files, entrypoint });

    expect(res2.status).toBe(500);
    expect(res2.body).toHaveProperty("error", "note already verified");
  });

  it("doesn't verify a counter-note if sources don't match", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("Felt::from_u32", "felt!");

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: COUNTER_NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-notes/:noteId", () => {
  it("returns 404 for a note absent from the registry", async () => {
    const res = await apiV1
      .get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID_1}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: COUNTER_NOTE_ID_1, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID_1}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", COUNTER_NOTE_ID_1);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package.name", entrypoint);
    expect(res2.body).toHaveProperty("package.type", "note");
  });

  it("returns a match for a different note sharing the same script", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    // Verify one note...
    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: COUNTER_NOTE_ID_1, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // ...then look up a *different*, never-verified note with the same script.
    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID_2}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", COUNTER_NOTE_ID_2);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package");
  });
});
