import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accounts,
  BANK_ACCOUNT_ID_1,
  BASIC_WALLET_ID_1,
  COUNT_READER_ID,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  DEPOSIT_NOTE_ID_1,
  editProjectFile,
  notes,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { describe, expect, it, vi } from "vitest";
import { VerifierError, verify } from "../src/lib/verify.ts";
import { useFakeTool } from "./fake-tool.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;
const bankDir = `${examplesDir}/miden-bank`;

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

// Well-formed IDs nothing on-chain carries.
const MISSING_ACCOUNT_ID = "0x8d47282fd52608116741a813b3ae2d";
const MISSING_NOTE_ID = `0x${"5a".repeat(32)}`;

// `verify` runs in-process: `miden-verifier` runs from its client cache dir,
// which must exist (the host has no `/cache`).
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  MIDEN_CLIENT_CACHE_DIR: (await import("node:os")).tmpdir(),
}));

// Behaves as the resource ID (its 4th argument) says.
const FAKE_MIDEN_VERIFIER = `#!/bin/sh
case "$4" in
  ok) echo '{"type":"note","code":"0x01","script":"Custom(0x02)"}' ;;
  missing) echo "Error: account with id $4 not found on the network" >&2; exit 2 ;;
  broken) printf 'Error: rpc error\n\nCaused by:\n    request timed out\n' >&2; exit 1 ;;
esac
`;

describe("POST /verify", () => {
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

    const res = await api.post("/verify").send({ files, networkId });

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
      .send({ files, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty(
      "root",
      accounts[COUNTER_CONTRACT_ID_1].code,
    );
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain counter-contract", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty(
      "root",
      accounts[COUNTER_CONTRACT_ID_1].code,
    );
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
    expect(res.body.files).toEqual(files);
  });

  it("returns the lockfile an on-chain counter-contract was verified with", async () => {
    const { "Cargo.lock": _, ...files } = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    const { "Cargo.lock": cargoLock, ...sources } = res.body.files;
    expect(sources).toEqual(files);
    expect(cargoLock).toContain('name = "counter-contract"');
  });

  it("doesn't verify a counter-contract not found on network", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      networkId,
      resourceId: MISSING_ACCOUNT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("doesn't verify a counter-contract if sources don't match", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    expect(files["Cargo.toml"]).toBeDefined();
    editProjectFile(files, "src/lib.rs", (content) =>
      content.replaceAll("+", "-"),
    );

    const resourceId = COUNTER_CONTRACT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
    expect(res.body).toHaveProperty(
      "root",
      accounts[COUNTER_CONTRACT_ID_1].code,
    );
  });

  // Mainnet has no fixtures: this checks against the public USDCx fee faucet,
  // whose code the counter-contract doesn't match.
  it("doesn't verify a counter-contract against a Mainnet account with other code", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api.post("/verify").send({
      files,
      networkId: "mm",
      resourceId: "0xe69e6ca6e39df1b10c1e5399399feb",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("doesn't verify against a network it doesn't serve", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );

    const res = await api.post("/verify").send({
      files,
      networkId: "mxx",
      resourceId: COUNTER_CONTRACT_ID_1,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported network ID `mxx`/);
  });

  it("verifies an on-chain auth-component-no-auth", async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/auth-component-no-auth`,
    );
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId: COUNTER_CONTRACT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
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
      .send({ files, entrypoint, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("root", notes[COUNTER_NOTE_ID_1].code);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain counter-note", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: COUNTER_NOTE_ID_1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("root", notes[COUNTER_NOTE_ID_1].code);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify a counter-note not found on network", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: MISSING_NOTE_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("doesn't verify a counter-note if sources don't match", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    editProjectFile(files, `${entrypoint}/src/lib.rs`, (content) =>
      content.replace("felt!", "Felt::from_u32"),
    );

    const resourceId = COUNTER_NOTE_ID_1;
    const { resource } = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("verifies a local count-reader", async () => {
    const files = await readProjectFiles(counterContractDir);
    const entrypoint = "count-reader";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId = COUNT_READER_ID;
    const { resource } = accounts[resourceId];

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: COUNT_READER_ID,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
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
      networkId,
      resourceId: BASIC_WALLET_ID_1,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies a local basic-wallet", async () => {
    const files = await readProjectFiles(`${basicWalletDir}/basic-wallet`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = BASIC_WALLET_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api.post("/verify").send({
      files,
      networkId,
      resourceId: BASIC_WALLET_ID_1,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies a local bank-account", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const resourceId = BANK_ACCOUNT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain bank-account", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId: BANK_ACCOUNT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
    expect(res.body.files).toEqual(files);
  });

  it("returns the lockfile an on-chain bank-account was verified with", async () => {
    const { "Cargo.lock": _, ...files } = await readProjectFiles(
      `${bankDir}/bank-account`,
    );

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId: BANK_ACCOUNT_ID_1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    const { "Cargo.lock": cargoLock, ...sources } = res.body.files;
    expect(sources).toEqual(files);
    expect(cargoLock).toContain('name = "bank-account"');
  });

  it("doesn't verify a bank-account not found on network", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);
    expect(files["Cargo.toml"]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      networkId,
      resourceId: MISSING_ACCOUNT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("doesn't verify a bank-account if sources don't match", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);
    expect(files["Cargo.toml"]).toBeDefined();
    editProjectFile(files, "src/lib.rs", (content) =>
      content.replace(
        "MAX_DEPOSIT_AMOUNT: u64 = 1_000_000",
        "MAX_DEPOSIT_AMOUNT: u64 = 2_000_000",
      ),
    );

    const resourceId = BANK_ACCOUNT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("verifies a local deposit-note", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "deposit-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const resourceId = DEPOSIT_NOTE_ID_1;
    const { resource } = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("verifies an on-chain deposit-note", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "deposit-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: DEPOSIT_NOTE_ID_1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
  });

  it("doesn't verify a deposit-note not found on network", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "deposit-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: MISSING_NOTE_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("doesn't verify a deposit-note if sources don't match", async () => {
    const files = await readProjectFiles(bankDir);
    const entrypoint = "deposit-note";
    expect(files[`${entrypoint}/Cargo.toml`]).toBeDefined();
    editProjectFile(files, `${entrypoint}/src/lib.rs`, (content) =>
      content.replace(
        "account.deposit(depositor, asset);",
        "account.deposit(depositor, asset);\n            account.deposit(depositor, asset);",
      ),
    );

    const resourceId = DEPOSIT_NOTE_ID_1;
    const { resource } = notes[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, entrypoint, networkId, resourceId, resource });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("verify with a faked miden-verifier", () => {
  useFakeTool("miden-verifier", FAKE_MIDEN_VERIFIER);
  const run = (resourceId: string) =>
    verify({
      networkId: "mtst",
      resourceId,
      maspPath: "package.masp",
      commitment: "0x02",
    });

  it("answers whether it verified, with the resource's root", async () => {
    await expect(run("ok")).resolves.toEqual({ verified: true, root: "0x01" });
  });

  it("fails with a 400 when the tool rejects the request", async () => {
    const error = run("missing");
    await expect(error).rejects.toBeInstanceOf(VerifierError);
    await expect(error).rejects.toMatchObject({
      status: 400,
      message: "account with id missing not found on the network",
    });
  });

  it("fails with a 502 when the tool fails", async () => {
    await expect(run("broken")).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/^rpc error/),
    });
  });
});
