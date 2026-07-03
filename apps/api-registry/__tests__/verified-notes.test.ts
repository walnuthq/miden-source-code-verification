import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(
  __dirname,
  "../../api-compile/project-template",
);

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = "mtst";

const NOTE_ID_1 =
  "0x5c546cf624fa9a381d006f64194ad08bc9fcc30629184c64f5b0fe33bf1e2796";
const NOTE_ID_2 =
  "0x230560f38b6af790e5b790b438dc64d05b9b65dc762a25be4b61c4830d7dede9";
const NOTE_ID_3 =
  "0x1fdc8f1582f9f39dbf4a045c73fce3088332714357c00a7a68221541e86a0db7";

describe("POST /:networkId/verified-notes", () => {
  it("rejects requests with no note ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing noteId");
  });

  it("rejects requests with no files object", async () => {
    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: NOTE_ID_1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(templateDir);
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: NOTE_ID_1,
      files: {
        "increment-note/src/lib.rs": files["increment-note/src/lib.rs"],
      },
      entrypoint: "increment-note",
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(templateDir);
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: NOTE_ID_1,
      files: {
        "increment-note/src/lib.rs": files["increment-note/src/lib.rs"],
        "increment-note/Cargo.toml": files["increment-note/Cargo.toml"],
      },
      entrypoint: "increment-note",
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't verify a buggy increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("CounterContract", "CounterAccount");

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(500);
  });

  it("verifies an increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify an already verified increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const noteId = NOTE_ID_2;

    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

    expect(res2.status).toBe(500);
    expect(res2.body).toHaveProperty("error", "note already verified");
  });

  it("doesn't verify an increment-note if sources don't match", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("Felt::from_u32", "felt!");

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId: NOTE_ID_1,
      files,
      entrypoint,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-notes/:noteId", () => {
  it("returns 404 for a non-existent verified note", async () => {
    const noteId =
      "0x0000000000000000000000000000000000000000000000000000000000000000";

    const res = await apiV1
      .get(`/${networkId}/verified-notes/${noteId}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const noteId = NOTE_ID_3;

    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/${noteId}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", noteId);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("package");
  });
});
