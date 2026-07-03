import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../project-template");

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("POST /compile", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/compile").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    const res = await api
      .post("/compile")
      .send({ files: { "src/lib.rs": files["src/lib.rs"] } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    const res = await api
      .post("/compile")
      .send({
        files: {
          "src/lib.rs": files["src/lib.rs"],
          "Cargo.toml": files["Cargo.toml"],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't compile a buggy counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replace(", Word", "");

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).not.toHaveProperty("masp");
    expect(res.body).not.toHaveProperty("digest");
    expect(res.body).not.toHaveProperty("manifest");
  });

  it("compiles a counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an increment-note", async () => {
    const files = await readProjectFiles(templateDir);
    const entrypoint = "increment-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });
});
