import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  accounts,
  BASIC_WALLET_ID_1,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
} from "./data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("POST /verify", () => {
  it("rejects requests with no files object", async () => {
    const res = await api.post("/verify").send({});

    expect(res.status).toBe(400);

    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api
      .post("/verify")
      .send({ files: { "src/lib.rs": files["src/lib.rs"] } });

    expect(res.status).toBe(400);

    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
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
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({ files });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing networkId");
  });

  it("rejects requests missing resource ID", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      networkId: "mtst",
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing resourceId");
  });

  it("verifies a local counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = COUNTER_CONTRACT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify a counter-contract not found on network", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mdev", resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(500);
  });

  it("doesn't verify a counter-contract if sources don't match", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll("+", "-");

    const resourceId = COUNTER_CONTRACT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("verifies an on-chain auth-component-no-auth", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/auth-component-no-auth`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId: "mtst", resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies a local counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId = COUNTER_NOTE_ID_1;
    const { resource } = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId: "mtst",
      resourceId: COUNTER_NOTE_ID_1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify a counter-note not found on network", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId: "mdev",
      resourceId: COUNTER_NOTE_ID_1,
    });

    expect(res.status).toBe(500);
  });

  it("doesn't verify a counter-note if sources don't match", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("Felt::from_u32", "felt!");

    const resourceId = COUNTER_NOTE_ID_1;
    const { resource } = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: "mtst", resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("verifies a local auth-component-rpo-falcon512", async () => {
    const files = await readProjectFiles(
      `${basicWalletDir}/auth-component-rpo-falcon512`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = BASIC_WALLET_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api.post("/verify").send({
      files,
      networkId: "mtst",
      resourceId: BASIC_WALLET_ID_1,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies a local basic-wallet", async () => {
    const files = await readProjectFiles(`${basicWalletDir}/basic-wallet`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = BASIC_WALLET_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api.post("/verify").send({
      files,
      networkId: "mtst",
      resourceId: BASIC_WALLET_ID_1,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("digest");
    expect(res.body).toHaveProperty("manifest");
  });
});
