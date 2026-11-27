import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  accounts,
  COUNTER_CONTRACT_ID,
  COUNTER_NOTE_ID,
  editProjectFile,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { RUST_PROJECT_ERROR } from "miden-source-code-verification-utils/project";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.ts";
import { type ApiCompile, ApiCompileError } from "../src/lib/api-compile.ts";
import { fakeApiCompile } from "./fake-api-compile.ts";

// The fixtures, deployed by `pnpm generate-fixtures` from the projects in
// `examples`, which are sent with `examples` as the root: the note depends on
// the counter by path.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");
const ENTRYPOINT = "counter-contract";
const counterMasm = "counter-contract/counter_contract.masm";

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

// Queried directly to check the registry forwards `/import`'s fields as is.
const apiCompileUrl = process.env.API_COMPILE_URL ?? "http://localhost:8080";

const networkId = process.env.NETWORK_ID ?? "mtst";

// A second network, used to check that records don't leak across networks. Only
// ever passed to the code-keyed route, which is a pure database read — so no
// account has to exist on it.
const otherNetworkId = "mlcl";

const ACCOUNT_CODE = accounts[COUNTER_CONTRACT_ID].code;

// A well-formed account code that is never verified in these tests, used to
// check that a code-keyed lookup which matches nothing yields a 404.
const UNVERIFIED_ACCOUNT_CODE = `0x${"ab".repeat(32)}`;

const examples = () => readProjectFiles(examplesDir);

// Verifies the fixture account with `files`, the examples by default.
const verifyCounterContract = async (files?: Record<string, string>) =>
  apiV1.post(`/${networkId}/verified-accounts`).send({
    accountId: COUNTER_CONTRACT_ID,
    files: files ?? (await examples()),
    entrypoint: ENTRYPOINT,
  });

describe("POST /:networkId/verified-accounts", () => {
  it("rejects requests with no account ID", async () => {
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing accountId");
  });

  it("rejects a files map with no miden-project.toml", async () => {
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: COUNTER_CONTRACT_ID,
      files: { "counter_contract.masm": "" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("rejects a Rust project", async () => {
    const files = {
      ...(await examples()),
      "counter-contract/Cargo.toml": '[package]\nname = "counter-contract"\n',
    };
    const res = await verifyCounterContract(files);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: RUST_PROJECT_ERROR });
    // The released `miden verify` CLI prints it as is.
    expect(res.body.error).toBe(
      "Rust projects are no longer verified. Miden projects are written in MASM: upload a `miden-project.toml` project. If you use the `miden verify` CLI, upgrade to 0.8.0 or later.",
    );
  });

  it("rejects a file path that would leave the project", async () => {
    const res = await verifyCounterContract({ ...(await examples()), "../evil.masm": "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid file path: ../evil.masm");
  });

  it("doesn't verify a counter-contract that doesn't build", async () => {
    const files = await examples();
    editProjectFile(files, counterMasm, (content) =>
      content.replace("movup.4 add", "movup.4 addd"),
    );

    const res = await verifyCounterContract(files);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(counterMasm);
  });

  it("verifies a counter-contract", async () => {
    const res = await verifyCounterContract();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a counter-contract whose code is already in the registry", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await verifyCounterContract();
    expect(res2.status).toBe(409);
    expect(res2.body).toHaveProperty("error", "account component already verified");
  });

  it("doesn't verify a counter-contract if sources don't match", async () => {
    const files = await examples();
    editProjectFile(files, counterMasm, (content) =>
      content.replace('word("counter_contract::count")', 'word("counter_contract::other_count")'),
    );

    const res = await verifyCounterContract(files);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("GET /:networkId/verified-accounts/:accountId", () => {
  it("returns 404 for an account absent from the registry", async () => {
    const res = await apiV1.get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`).send();
    expect(res.status).toBe(404);
  });

  it("returns a previously verified account", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1.get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`).send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("accountId", COUNTER_CONTRACT_ID);
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).toHaveProperty("code", ACCOUNT_CODE);
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.name",
      "counter-contract",
    );
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.type",
      "account-component",
    );
    const [component] = res2.body.verifiedAccountComponents;
    expect(component.package.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(component).toHaveProperty("packageCommitment", component.package.commitment);
    // The compiled package is served on its own, not inlined in the record.
    expect(component.package).not.toHaveProperty("masp");

    const res3 = await apiV1
      .get(`/${networkId}/packages/masp/${component.package.commitment}.masp`)
      .responseType("blob");

    expect(res3.status).toBe(200);
    expect(res3.headers["content-type"]).toBe("application/octet-stream");
    expect(res3.body.length).toBeGreaterThan(0);
  });

  it("forwards the standard components and procedures from the import", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const imported = await request(apiCompileUrl).get(
      `/${networkId}/import/${COUNTER_CONTRACT_ID}`,
    );
    expect(imported.status).toBe(200);

    const res2 = await apiV1.get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`).send();

    expect(res2.status).toBe(200);
    expect(res2.body.procedures).toEqual(imported.body.procedures);
    expect(res2.body.standardAccountComponents).toEqual(imported.body.standardAccountComponents);
    expect(res2.body.procedures.length).toBeGreaterThan(0);
  });
});

describe("GET /:networkId/verified-accounts/code/:code", () => {
  it("returns a previously verified account, without an on-chain lookup", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1.get(`/${networkId}/verified-accounts/code/${ACCOUNT_CODE}`).send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("code", ACCOUNT_CODE);
    // The record is keyed on the network it was verified against, so the
    // network comes back on it — but no account took part in the lookup, so
    // there is no id to echo, unlike the id-keyed endpoint.
    expect(res2.body).toHaveProperty("networkId", networkId);
    expect(res2.body).not.toHaveProperty("accountId");
    // Nor any of the on-chain import's fields.
    expect(res2.body).not.toHaveProperty("standardAccountComponents");
    expect(res2.body).not.toHaveProperty("procedures");
    expect(res2.body.verifiedAccountComponents).toHaveLength(1);
    expect(res2.body.verifiedAccountComponents[0]).toHaveProperty(
      "package.name",
      "counter-contract",
    );
  });

  it("doesn't return an account verified on another network", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    // The same code root, but a network it was never verified on. Code roots
    // are network-specific, so this must not resolve to the record above.
    const res2 = await apiV1
      .get(`/${otherNetworkId}/verified-accounts/code/${ACCOUNT_CODE}`)
      .send();

    expect(res2.status).toBe(404);
    expect(res2.body).toHaveProperty("error", "verified account not found");
  });

  it("matches a code case-insensitively", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/code/0x${ACCOUNT_CODE.slice(2).toUpperCase()}`)
      .send();

    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty("code", ACCOUNT_CODE);
  });

  it("returns 404 for a code absent from the registry", async () => {
    const res1 = await verifyCounterContract();
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty("verified", true);

    const res2 = await apiV1
      .get(`/${networkId}/verified-accounts/code/${UNVERIFIED_ACCOUNT_CODE}`)
      .send();

    expect(res2.status).toBe(404);
    expect(res2.body).toHaveProperty("error", "verified account not found");
  });

  it("rejects an account id in place of a code", async () => {
    // Account ids are shorter than the 32-byte code root, so the likeliest
    // mistake gets a clear 400 rather than a puzzling 404.
    const res = await apiV1
      .get(`/${networkId}/verified-accounts/code/${COUNTER_CONTRACT_ID}`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid code");
  });
});

describe("GET /:networkId/verified-accounts/:accountId with a faked import", () => {
  // In process, with an api-compile whose import answers as set: the other
  // tests query the running registry, whose api-compile is real.
  const appWhoseImport = (importResource: ApiCompile["importResource"]) =>
    request(createApp({ apiCompile: fakeApiCompile({ importResource }) }));
  const appWhoseImportFails = (error: ApiCompileError) =>
    appWhoseImport(() => Promise.reject(error));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 for an account api-compile didn't find", async () => {
    const app = appWhoseImportFails(new ApiCompileError("not found on the network", 404));
    const res = await app.get(`/v1/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified account not found" });
  });

  it("returns 404 for a note's id, whatever its script", async () => {
    // The script is a verified account code, so the 404 comes from the
    // import's kind, not from a miss on the root.
    const res1 = await verifyCounterContract();
    expect(res1.body).toHaveProperty("verified", true);

    const app = appWhoseImport(async () => ({
      type: "note",
      code: ACCOUNT_CODE,
    }));
    const res = await app.get(`/v1/${networkId}/verified-accounts/${COUNTER_NOTE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "verified account not found" });
  });

  it.each([
    [502, "rpc error: request timed out"],
    [504, "api-compile did not answer in time"],
  ])("passes an api-compile %i through", async (status, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWhoseImportFails(new ApiCompileError(error, status));
    const res = await app.get(`/v1/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
  });
});
