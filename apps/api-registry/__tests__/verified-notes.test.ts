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

// All three are increment-note instances that share the same note script, so
// they resolve to the same `script` in the registry. This is what lets a
// verification of one satisfy a lookup of another.
const NOTE_ID_1 =
  "0x5101df16c6b3d79a0e680e4a08c813cbc634e59c51bae4e83b8a8bd69f614160";
const NOTE_ID_2 =
  "0x59a97ea12e7111c10838a23760fe96d7abeb67685f0b9a79acdfc65302d6c3e7";
const NOTE_ID_3 =
  "0x7656b5ef18b07af1c75d6af983d7aac35c3c5800fdecd95974893b9b9645f302";
const NOTE_SCRIPT =
  "0x8050a19937200574e48db986a50fb207ce31e7b55563383e2194ccd696ddd95c";

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

  it("doesn't verify an increment-note whose script is already in the registry", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    // First note registers the script.
    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: NOTE_ID_1, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // A different note sharing the same script is already covered.
    const res2 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: NOTE_ID_2, files, entrypoint });

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
  it("returns 404 for a note absent from the registry", async () => {
    const res = await apiV1
      .get(`/${networkId}/verified-notes/${NOTE_ID_1}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: NOTE_ID_3, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/${NOTE_ID_3}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", NOTE_ID_3);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package.name", entrypoint);
    expect(res2.body).toHaveProperty("package.type", "note");
  });

  it("returns a match for a different note sharing the same script", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    // Verify one note...
    const res1 = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId: NOTE_ID_1, files, entrypoint });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // ...then look up a *different*, never-verified note with the same script.
    const res2 = await apiV1
      .get(`/${networkId}/verified-notes/${NOTE_ID_2}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("noteId", NOTE_ID_2);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("script", NOTE_SCRIPT);
    expect(res2.body).toHaveProperty("package");
  });
});
