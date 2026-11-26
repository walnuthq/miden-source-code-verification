import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  accounts,
  COUNTER_CONTRACT_ID,
  COUNTER_NOTE_ID,
  editProjectFile,
  notes,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { RUST_PROJECT_ERROR } from "miden-source-code-verification-utils/project";
import { describe, expect, it, vi } from "vitest";

import { VerifierError, verify } from "../src/lib/verify.ts";
import { useFakeTool } from "./fake-tool.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// The fixtures, deployed by `generate-fixtures` from the projects in
// `examples`. The note's project depends on `../counter-contract`, so the
// projects are sent with `examples` as the root.
const examplesDir = path.resolve(__dirname, "../examples");

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

describe("POST /verify refuses", () => {
  it("a files map with no miden-project.toml", async () => {
    const res = await api.post("/verify").send({ files: { "src/lib.masm": "" } });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing miden-project.toml");
  });

  it("a Rust project", async () => {
    const files = await readProjectFiles(examplesDir);
    files["counter-contract/Cargo.toml"] = '[package]\nname = "counter-contract"\n';

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId: COUNTER_CONTRACT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: RUST_PROJECT_ERROR });
  });

  it("a request with no network ID", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({ files, entrypoint: "counter-contract" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing networkId");
  });

  it("a network ID or a resource ID that isn't a string", async () => {
    const files = await readProjectFiles(examplesDir);
    const entrypoint = "counter-contract";

    const badNetwork = await api
      .post("/verify")
      .send({ files, entrypoint, networkId: ["mtst"], resourceId: "0x1" });
    expect(badNetwork.status).toBe(400);
    expect(badNetwork.body).toHaveProperty("error", "missing networkId");

    const badResource = await api
      .post("/verify")
      .send({ files, entrypoint, networkId, resourceId: { id: "0x1" } });
    expect(badResource.status).toBe(400);
    expect(badResource.body).toHaveProperty("error", "missing resourceId");
  });

  it("a request with no resource ID", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api
      .post("/verify")
      .send({ files, entrypoint: "counter-contract", networkId });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing resourceId");
  });

  it("a resource that isn't a string", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId: COUNTER_CONTRACT_ID,
      resource: 42,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid resource" });
  });
});

describe("POST /verify", () => {
  it("verifies an on-chain counter-contract", async () => {
    const files = await readProjectFiles(examplesDir);
    const entrypoint = "counter-contract";
    expect(files[`${entrypoint}/miden-project.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: COUNTER_CONTRACT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("root", accounts[COUNTER_CONTRACT_ID].code);
    expect(res.body).toHaveProperty("masp");
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("manifest");
    expect(res.body).toHaveProperty("builtWith");
    expect(res.body).toHaveProperty("diagnostics", []);
    expect(res.body).not.toHaveProperty("storage");
    expect(res.body.files).toEqual(files);
  });

  it("verifies a local counter-contract", async () => {
    const files = await readProjectFiles(examplesDir);
    const resourceId = COUNTER_CONTRACT_ID;
    const { resource } = accounts[resourceId];

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("verifies an on-chain counter-note with its dependency", async () => {
    const files = await readProjectFiles(examplesDir);
    const entrypoint = "counter-note";
    expect(files[`${entrypoint}/miden-project.toml`]).toBeDefined();

    const res = await api.post("/verify").send({
      files,
      entrypoint,
      networkId,
      resourceId: COUNTER_NOTE_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
    expect(res.body).toHaveProperty("root", notes[COUNTER_NOTE_ID].code);
    expect(res.body).not.toHaveProperty("noteStorage");
  });

  it("verifies a local counter-note", async () => {
    const files = await readProjectFiles(examplesDir);
    const resourceId = COUNTER_NOTE_ID;
    const { resource } = notes[resourceId];

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-note",
      networkId,
      resourceId,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a counter-contract with a changed constant", async () => {
    const files = await readProjectFiles(examplesDir);
    editProjectFile(files, "counter-contract/counter_contract.masm", (content) =>
      content.replace('word("counter_contract::count")', 'word("counter_contract::other_count")'),
    );

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId: COUNTER_CONTRACT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
    expect(res.body).toHaveProperty("root", accounts[COUNTER_CONTRACT_ID].code);
  });

  it("doesn't verify a counter-contract not found on network", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId: MISSING_ACCOUNT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("doesn't verify a counter-note not found on network", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-note",
      networkId,
      resourceId: MISSING_NOTE_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  // Mainnet has no fixtures: this checks against the public USDCx fee faucet,
  // whose code the counter-contract doesn't match.
  it("doesn't verify a counter-contract against a Mainnet account with other code", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId: "mm",
      resourceId: "0xe69e6ca6e39df1b10c1e5399399feb",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });

  it("doesn't verify against a network it doesn't serve", async () => {
    const files = await readProjectFiles(examplesDir);

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId: "mxx",
      resourceId: COUNTER_CONTRACT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported network ID `mxx`/);
  });

  it("doesn't verify account bytes sent under another account's ID", async () => {
    const files = await readProjectFiles(examplesDir);
    const { resource } = accounts[COUNTER_CONTRACT_ID];

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-contract",
      networkId,
      resourceId: MISSING_ACCOUNT_ID,
      resource,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("resource is not account");
  });

  it("doesn't verify note bytes sent under another note's ID", async () => {
    const files = await readProjectFiles(examplesDir);
    const { resource } = notes[COUNTER_NOTE_ID];

    const res = await api.post("/verify").send({
      files,
      entrypoint: "counter-note",
      networkId,
      resourceId: MISSING_NOTE_ID,
      resource,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("resource is not note");
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
