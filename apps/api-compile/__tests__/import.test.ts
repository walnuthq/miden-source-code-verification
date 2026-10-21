import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import {
  accounts,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
} from "miden-source-code-verification-test-utils";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import importRouter from "../src/routes/import.js";

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

// Well-formed IDs nothing on-chain carries.
const MISSING_ACCOUNT_ID = "0x8d47282fd52608116741a813b3ae2d";
const MISSING_NOTE_ID = `0x${"5a".repeat(32)}`;

// The in-process route runs a fake `miden-import` from this directory, with a
// tool timeout short enough to trip.
const { fakeBinDir } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { fakeBinDir: await mkdtemp(join(tmpdir(), "fake-miden-import-")) };
});
vi.mock("../src/lib/constants.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.js")>()),
  MIDEN_CLIENT_CACHE_DIR: fakeBinDir,
  MIDEN_TOOL_TIMEOUT_MS: 500,
}));

// Behaves as the resource ID (its 4th argument) says.
const FAKE_MIDEN_IMPORT = `#!/bin/sh
case "$4" in
  ok) echo '{"type":"note","code":"0x01"}' ;;
  missing) echo "Error: account with id $4 not found on the network" >&2; exit 2 ;;
  broken) printf 'Error: rpc error\n\nCaused by:\n    request timed out\n' >&2; exit 1 ;;
  garbled) echo "not json" ;;
  slow) sleep 5 ;;
esac
`;

describe("GET /:networkId/import/:resourceId", () => {
  it("imports an on-chain account", async () => {
    const res = await api.get(`/${networkId}/import/${COUNTER_CONTRACT_ID_1}`);

    const { code } = accounts[COUNTER_CONTRACT_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
    expect(res.body).toHaveProperty("code", code);
  });

  it("lists an account's procedures and the standard components among them", async () => {
    const res = await api.get(`/${networkId}/import/${COUNTER_CONTRACT_ID_1}`);

    expect(res.status).toBe(200);
    const { standardAccountComponents, procedures } = res.body as {
      standardAccountComponents: { name: string; procedures: string[] }[];
      procedures: string[];
    };

    // The counter-contract carries `BasicWallet` to pay fees, and the schema
    // commitment `build_with_schema_commitment` adds to every account.
    expect(standardAccountComponents.map(({ name }) => name)).toEqual([
      "BasicWallet",
      "SchemaCommitment",
    ]);

    for (const procedure of procedures) {
      expect(procedure).toMatch(/^0x[0-9a-f]{64}$/);
    }
    const claimed = standardAccountComponents.flatMap(
      (component) => component.procedures,
    );
    expect(claimed.length).toBeGreaterThan(0);
    // Each procedure is claimed by at most one component, and only procedures
    // of the account are claimed.
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const procedure of claimed) {
      expect(procedures).toContain(procedure);
    }
    // The custom counter and no-auth components' procedures are left over.
    expect(procedures.length).toBeGreaterThan(claimed.length);
  });

  it("imports an on-chain note", async () => {
    const res = await api.get(`/${networkId}/import/${COUNTER_NOTE_ID_1}`);

    const { code } = notes[COUNTER_NOTE_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "note");
    expect(res.body).toHaveProperty("code", code);
    expect(res.body).not.toHaveProperty("standardAccountComponents");
    expect(res.body).not.toHaveProperty("procedures");
  });

  it("returns 404 for an account not found on the network", async () => {
    const res = await api.get(`/${networkId}/import/${MISSING_ACCOUNT_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found on the network/);
  });

  it("returns 404 for a note not found on the network", async () => {
    const res = await api.get(`/${networkId}/import/${MISSING_NOTE_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for an ID that isn't a resource", async () => {
    const res = await api.get(`/${networkId}/import/nonsense`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/is not a valid/);
  });
});

describe("GET /:networkId/import/:resourceId when miden-import fails", () => {
  const app = express().use(importRouter);
  const path = process.env.PATH;

  beforeAll(async () => {
    const fake = join(fakeBinDir, "miden-import");
    await writeFile(fake, FAKE_MIDEN_IMPORT);
    await chmod(fake, 0o755);
    process.env.PATH = `${fakeBinDir}:${path}`;
  });

  afterAll(async () => {
    process.env.PATH = path;
    await rm(fakeBinDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers what it imported", async () => {
    const res = await request(app).get("/mtst/import/ok");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "note", code: "0x01" });
  });

  it("returns 404 when it exits with 2", async () => {
    const res = await request(app).get("/mtst/import/missing");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "account with id missing not found on the network",
    });
  });

  it("returns 502 when it exits with 1", async () => {
    const res = await request(app).get("/mtst/import/broken");

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/^rpc error/);
  });

  it("returns 502 when it times out", async () => {
    const res = await request(app).get("/mtst/import/slow");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "miden-import timed out after 0.5s" });
  });

  it("returns 500 when its output isn't JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/mtst/import/garbled");

    expect(res.status).toBe(500);
  });
});
