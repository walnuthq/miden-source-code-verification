import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accounts,
  BASIC_WALLET_ID_1,
  COUNT_READER_ID,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
  readProjectFiles,
} from "miden-source-code-verification-test-utils";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VerifierError, verify } from "../src/lib/verify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../examples");
const counterContractDir = `${examplesDir}/counter-contract`;
const basicWalletDir = `${examplesDir}/basic-wallet`;

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

// Well-formed IDs nothing on-chain carries.
const MISSING_ACCOUNT_ID = "0x8d47282fd52608116741a813b3ae2d";
const MISSING_NOTE_ID = `0x${"5a".repeat(32)}`;

// `verify` runs in-process against a fake `miden-verifier` from this
// directory, with a tool timeout short enough to trip.
const { fakeBinDir } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { fakeBinDir: await mkdtemp(join(tmpdir(), "fake-miden-verifier-")) };
});
vi.mock("../src/lib/constants.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.js")>()),
  MIDEN_CLIENT_CACHE_DIR: fakeBinDir,
  MIDEN_TOOL_TIMEOUT_MS: 500,
}));

// Behaves as the resource ID (its 4th argument) says.
const FAKE_MIDEN_VERIFIER = `#!/bin/sh
case "$4" in
  ok) echo '{"type":"note","code":"0x01","script":"Custom(0x02)"}' ;;
  missing) echo "Error: account with id $4 not found on the network" >&2; exit 2 ;;
  broken) printf 'Error: rpc error\n\nCaused by:\n    request timed out\n' >&2; exit 1 ;;
  slow) sleep 5 ;;
esac
`;

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
    files["src/lib.rs"] = files["src/lib.rs"].replaceAll("+", "-");

    const resourceId = COUNTER_CONTRACT_ID_1;
    const { resource } = accounts[resourceId];

    const res = await api
      .post("/verify")
      .send({ files, networkId, resourceId, resource });

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
    files[`${entrypoint}/src/lib.rs`] = files[
      `${entrypoint}/src/lib.rs`
    ].replace("felt!", "Felt::from_u32");

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
});

describe("verify when miden-verifier fails", () => {
  const path = process.env.PATH;
  const run = (resourceId: string) =>
    verify({
      networkId: "mtst",
      resourceId,
      maspPath: "package.masp",
      commitment: "0x02",
    });

  beforeAll(async () => {
    const fake = `${fakeBinDir}/miden-verifier`;
    await writeFile(fake, FAKE_MIDEN_VERIFIER);
    await chmod(fake, 0o755);
    process.env.PATH = `${fakeBinDir}:${path}`;
  });

  afterAll(async () => {
    process.env.PATH = path;
    await rm(fakeBinDir, { recursive: true, force: true });
  });

  it("answers whether it verified", async () => {
    await expect(run("ok")).resolves.toBe(true);
  });

  it("fails with a 400 when it exits with 2", async () => {
    const error = run("missing");
    await expect(error).rejects.toBeInstanceOf(VerifierError);
    await expect(error).rejects.toMatchObject({
      status: 400,
      message: "account with id missing not found on the network",
    });
  });

  it("fails with a 502 when it exits with 1", async () => {
    await expect(run("broken")).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/^rpc error/),
    });
  });

  it("fails with a 502 when it times out", async () => {
    await expect(run("slow")).rejects.toMatchObject({
      status: 502,
      message: "miden-verifier timed out after 0.5s",
    });
  });
});
