import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-sourcify-test-utils";
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

describe("POST /:networkId/verified-notes", () => {
  it("rejects requests with no note ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-notes`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing noteId");
  });

  it("rejects requests with no files object", async () => {
    const noteId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const noteId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await apiV1.post(`/${networkId}/verified-notes`).send({
      noteId,
      files: { "src/lib.rs": "" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("doesn't verify a buggy increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace(
      "use crate::bindings::miden::counter_account::counter_account;",
      "",
    );

    const noteId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

    expect(res.status).toBe(500);
  });

  it("verifies an increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const noteId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify an already verified increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const noteId =
      "0x760fe63e27c45bf4be6d129dc2742df0d4d1d87658a51388c1364419d65dcfdd";

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

    const noteId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await apiV1
      .post(`/${networkId}/verified-notes`)
      .send({ noteId, files, entrypoint });

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

    const noteId =
      "0x80ffa5a91b21fd80ce8508257cac7c54390160478fc5e6f594d9eeda6e61f861";

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
