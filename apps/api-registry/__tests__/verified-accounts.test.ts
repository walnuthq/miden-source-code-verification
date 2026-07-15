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

// All three are counter-account deployments that share the same account code,
// so they resolve to the same `code` in the registry. This is what lets a
// verification of one satisfy a lookup of another.
const ACCOUNT_ID_1 = "0xa070576e2ee8d311021079d99e1374";
const ACCOUNT_ID_2 = "0xbe777957464638d1632b09779e8cdf";
const ACCOUNT_ID_3 = "0xe506fd9d2e9d757130743112e78e36";
const ACCOUNT_CODE =
  "0x57310acef2b607bca21235c9b5c22b1c3c812fa2ca8e1b82f269cd95d8b47db7";

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

  it("doesn't verify a counter-account whose code is already in the registry", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    // First account registers the code + component.
    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: ACCOUNT_ID_1, files });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // A different account sharing the same code is already covered.
    const res2 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ accountId: ACCOUNT_ID_2, files });

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

    const res = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: ACCOUNT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-accounts/:accountId", () => {
  it("returns 404 for an account absent from the registry", async () => {
    const res = await apiV1
      .get(`/${networkId}/verified-accounts/${ACCOUNT_ID_1}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified account", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: ACCOUNT_ID_3 });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/${ACCOUNT_ID_3}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", ACCOUNT_ID_3);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("code", ACCOUNT_CODE);
    expect(res2.body).toHaveProperty("verifiedAccountComponents");
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.name",
      "counter-account",
    );
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.type",
      "account-component",
    );
  });

  it("returns a match for a different account sharing the same code", async () => {
    const files = await readProjectFiles(`${templateDir}/counter-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    // Verify one account...
    const res1 = await apiV1
      .post(`/${networkId}/verified-accounts`)
      .send({ files, accountId: ACCOUNT_ID_1 });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // ...then look up a *different*, never-verified account with the same code.
    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/${ACCOUNT_ID_2}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", ACCOUNT_ID_2);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
  });
});
