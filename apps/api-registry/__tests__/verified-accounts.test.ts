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

const ACCOUNT_ID_1 = "0xa070576e2ee8d311021079d99e1374";
const ACCOUNT_ID_2 = "0xbe777957464638d1632b09779e8cdf";
const ACCOUNT_ID_3 = "0xe506fd9d2e9d757130743112e78e36";

describe("POST /:networkId/verified-accounts", () => {
  it("rejects requests with no account ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing accountId");
  });

  it("rejects requests with no files object", async () => {
    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: ACCOUNT_ID_1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing files");
  });

  it("rejects requests missing Cargo.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);

    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: ACCOUNT_ID_1,
      files: { "src/lib.rs": files["src/lib.rs"] },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing Cargo.toml");
  });

  it("rejects requests missing miden-project.toml", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);

    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: ACCOUNT_ID_1,
      files: {
        "src/lib.rs": files["src/lib.rs"],
        "Cargo.toml": files["Cargo.toml"],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("doesn't verify a buggy counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replace(", Word", "");

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: ACCOUNT_ID_1, files });

    expect(res.status).toBe(500);
  });

  it("verifies a counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: ACCOUNT_ID_1, files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify an already verified counter-account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const accountId = ACCOUNT_ID_2;

    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId, files });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId, files });

    expect(res2.status).toBe(500);
    expect(res2.body).toHaveProperty(
      "error",
      "account component already verified",
    );
  });

  it("doesn't verify a counter-account if sources don't match", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll("+", "-");

    const accountId = ACCOUNT_ID_1;

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-accounts/:accountId", () => {
  it("returns 404 for a non-existent verified account", async () => {
    const accountId = "0x000000000000000000000000000000";

    const res = await apiV1
      .get(`/${networkId}/verified-accounts/${accountId}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const accountId = ACCOUNT_ID_3;

    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/${accountId}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", accountId);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("verifiedAccountComponents");
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
  });
});
