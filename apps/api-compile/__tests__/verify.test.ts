import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { accounts, notes } from "./data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../project-template");

const api = request(process.env.API_URL ?? "http://localhost:8080");

const ACCOUNT_ID = "0x3c4d04b827248f717ed34a650e3eb3";
const NOTE_ID =
  "0x5c546cf624fa9a381d006f64194ad08bc9fcc30629184c64f5b0fe33bf1e2796";

describe("POST /verify", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/verify").send({});

    expect(res.status).toBe(400);

    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    const res = await api
      .post("/verify")
      .send({ files: { "src/lib.rs": files["src/lib.rs"] } });

    expect(res.status).toBe(400);

    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    const res = await api.post("/verify").send({
      files: {
        "src/lib.rs": files["src/lib.rs"],
        "Cargo.toml": files["Cargo.toml"],
      },
    });

    expect(res.status).toBe(400);

    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("rejects requests missing network ID", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({ files });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing networkId");
  });

  it("rejects requests missing resource ID", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      networkId: "mtst",
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing resourceId");
  });

  it("verifies a local counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = ACCOUNT_ID;
    const resource = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId: ACCOUNT_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify a counter-account not found on network", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mdev", resourceId: ACCOUNT_ID });

    expect(res.status).toBe(500);
  });

  it("doesn't verify a counter-account if sources don't match", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll("+", "-");

    const resourceId = ACCOUNT_ID;
    const resource = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("verifies a local increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId = NOTE_ID;
    const resource = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId: NOTE_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify an increment-note not found on network", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mdev", resourceId: NOTE_ID });

    expect(res.status).toBe(500);
  });

  it("doesn't verify an increment-note if sources don't match", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("Felt::from_u32", "felt!");

    const resourceId = NOTE_ID;
    const resource = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});
