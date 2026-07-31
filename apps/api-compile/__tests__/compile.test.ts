import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("POST /compile", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/compile").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api
      .post("/compile")
      .send({ files: { "src/lib.rs": files["src/lib.rs"] } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api.post("/compile").send({
      files: {
        "src/lib.rs": files["src/lib.rs"],
        "Cargo.toml": files["Cargo.toml"],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't compile a buggy counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
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

  it("compiles a counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a counter-script", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-script";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/compile").send({ files, entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an auth-component-no-auth", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/auth-component-no-auth`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles an auth-component-rpo-falcon512", async () => {
    const files = await readProjectFiles(
      `${basicWalletDir}/auth-component-rpo-falcon512`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a basic-wallet", async () => {
    const files = await readProjectFiles(`${basicWalletDir}/basic-wallet`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stdout");
    expect(res.body).toHaveProperty("stderr");
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("compiles a basic-wallet-tx-script", async () => {
    const files = await readProjectFiles(basicWalletDir);
    const entrypoint = "basic-wallet-tx-script";
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
