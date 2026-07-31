import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  COUNTER_CONTRACT_ID_1,
  COUNTER_CONTRACT_ID_2,
  accounts,
} from "../../api-compile/__tests__/data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = "mtst";

// All three are counter-contract deployments that share the same account code,
// so they resolve to the same `code` in the registry. This is what lets a
// verification of one satisfy a lookup of another.
const ACCOUNT_CODE = accounts[COUNTER_CONTRACT_ID_1].code;

describe("POST /:networkId/verified-accounts", () => {
  it("rejects requests with no account ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing accountId");
  });

  it("rejects requests with no files object", async () => {
    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: COUNTER_CONTRACT_ID_1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: COUNTER_CONTRACT_ID_1,
      files: { "src/lib.rs": files["src/lib.rs"] },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: COUNTER_CONTRACT_ID_1,
      files: {
        "src/lib.rs": files["src/lib.rs"],
        "Cargo.toml": files["Cargo.toml"],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't verify a buggy counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replace(", Word", "");

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: COUNTER_CONTRACT_ID_1, files });

    expect(res.status).toBe(500);
  });

  it("verifies a counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: COUNTER_CONTRACT_ID_1, files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a counter-contract whose code is already in the registry", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    // First account registers the code + component.
    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: COUNTER_CONTRACT_ID_1, files });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // A different account sharing the same code is already covered.
    const res2 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: COUNTER_CONTRACT_ID_1, files });

    expect(res2.status).toBe(500);
    expect(res2.body).toHaveProperty(
      "error",
      "account component already verified",
    );
  });

  it("doesn't verify a counter-contract if sources don't match", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll("+", "-");

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-accounts/:accountId", () => {
  it("returns 404 for an account absent from the registry", async () => {
    const res = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID_1}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified account", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: COUNTER_CONTRACT_ID_1 });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID_1}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", COUNTER_CONTRACT_ID_1);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("code", ACCOUNT_CODE);
    expect(res2.body).toHaveProperty("verifiedAccountComponents");
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.name",
      "counter-contract",
    );
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.type",
      "account-component",
    );
  });

  it("returns a match for a different account sharing the same code", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    // Verify one account...
    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: COUNTER_CONTRACT_ID_1 });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // ...then look up a *different*, never-verified account with the same code.
    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID_2}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", COUNTER_CONTRACT_ID_2);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
  });

  it("returns a match with 2 different verified account components", async () => {
    const files = await readProjectFiles(counterContractDir);

    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({
        files,
        entrypoint: "counter-contract",
        accountId: COUNTER_CONTRACT_ID_1,
      });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1.post(`/${networkId}/verified-accounts`).send({
      files,
      entrypoint: "auth-component-no-auth",
      accountId: COUNTER_CONTRACT_ID_1,
    });

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("verified", true);

    const res3 = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID_1}`)
      .send();

    expect(res3.status).toBe(200);
    expect(res3.body).toHaveProperty("accountId", COUNTER_CONTRACT_ID_1);
    expect(res3.body).toHaveProperty("networkId", networkId);
    expect(res3.body.verifiedAccountComponents).toHaveLength(2);
  });
});
