import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { readProjectFiles } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../project-template");
const dataDir = path.resolve(__dirname, "./data");

const api = request(process.env.API_URL ?? "http://localhost:8080");

const readDataFile = (filename: string) => {
  const full = path.join(dataDir, filename);
  return readFile(full, "utf8");
};

describe("POST /verify", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing files object" });
  });

  it("rejects requests missing Cargo.toml", async () => {
    const res = await api.post("/verify").send({ files: { "src/lib.rs": "" } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing Cargo.toml" });
  });

  it("rejects requests missing network ID", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    const res = await api.post("/verify").send({ files });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing network ID" });
  });

  it("rejects requests missing resource ID", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    const res = await api.post("/verify").send({
      files,
      networkId: "mtst",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing resource ID" });
  });

  it("verifies a local counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = "0x2a4ffb87b51720105c3bf91e5e7bd8";
    const resource = await readDataFile(`${resourceId}.txt`);

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(true);
  });

  it("verifies an on-chain counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = "0x2a4ffb87b51720105c3bf91e5e7bd8";

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(true);
  });

  it("doesn't verify a counter-account not found on network", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = "0x2a4ffb87b51720105c3bf91e5e7bd8";

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mdev", resourceId });

    expect(res.status).toBe(500);
  });

  it("doesn't verify a counter-account if sources don't match", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll(
      "CounterContract",
      "CounterAccount",
    );

    const resourceId = "0x2a4ffb87b51720105c3bf91e5e7bd8";
    const resource = await readDataFile(`${resourceId}.txt`);

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(false);
  });

  it("verifies a local increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";
    const resource = await readDataFile(`${resourceId}.txt`);

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(true);
  });

  it("verifies an on-chain increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(true);
  });

  it("doesn't verify an increment-note not found on network", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mdev", resourceId });

    expect(res.status).toBe(500);
  });

  it("doesn't verify an increment-note if sources don't match", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    files["increment-note/src/lib.rs"] = files[
      "increment-note/src/lib.rs"
    ].replace("Felt::from_u32", "felt!");

    const resourceId =
      "0x44891875fb920d963352fcd6623e1f3c97dd1e4d8cdc084778eeb4bbdf72dbac";
    const resource = await readDataFile(`${resourceId}.txt`);

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified");
    expect(res.body.verified).toBe(false);
  });
});
