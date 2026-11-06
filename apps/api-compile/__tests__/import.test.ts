import express from "express";
import {
  accounts,
  BANK_ACCOUNT_ID_1,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  DEPOSIT_NOTE_ID_1,
  notes,
  request,
} from "miden-source-code-verification-test-utils";
import { errorHandler } from "miden-source-code-verification-utils/http-errors";
import { describe, expect, it, vi } from "vitest";
import importRouter from "../src/routes/import.ts";
import { useFakeTool } from "./fake-tool.ts";

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

// Well-formed IDs nothing on-chain carries.
const MISSING_ACCOUNT_ID = "0x8d47282fd52608116741a813b3ae2d";
const MISSING_NOTE_ID = `0x${"5a".repeat(32)}`;

// The in-process route runs `miden-import` from its client cache dir, which
// must exist: the host has no `/cache`.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  MIDEN_CLIENT_CACHE_DIR: (await import("node:os")).tmpdir(),
}));

// Behaves as the resource ID (its 4th argument) says.
const FAKE_MIDEN_IMPORT = `#!/bin/sh
case "$4" in
  ok) echo '{"type":"note","code":"0x01"}' ;;
  missing) echo "Error: account with id $4 not found on the network" >&2; exit 2 ;;
  broken) printf 'Error: rpc error\n\nCaused by:\n    request timed out\n' >&2; exit 1 ;;
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

  it("imports an on-chain bank account", async () => {
    const res = await api.get(`/${networkId}/import/${BANK_ACCOUNT_ID_1}`);

    const { code } = accounts[BANK_ACCOUNT_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
    expect(res.body).toHaveProperty("code", code);
  });

  it("lists a bank account's standard components", async () => {
    const res = await api.get(`/${networkId}/import/${BANK_ACCOUNT_ID_1}`);

    expect(res.status).toBe(200);
    const { standardAccountComponents, procedures } = res.body as {
      standardAccountComponents: { name: string; procedures: string[] }[];
      procedures: string[];
    };

    // The bank carries `BasicWallet` to receive assets and `NoAuth` to pay its
    // fee, on top of the schema commitment.
    expect(standardAccountComponents.map(({ name }) => name)).toEqual([
      "BasicWallet",
      "AuthNoAuth",
      "SchemaCommitment",
    ]);

    const claimed = standardAccountComponents.flatMap(
      (component) => component.procedures,
    );
    // The custom bank component's procedures are left over.
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

  it("imports an on-chain deposit-note", async () => {
    const res = await api.get(`/${networkId}/import/${DEPOSIT_NOTE_ID_1}`);

    const { code } = notes[DEPOSIT_NOTE_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "note");
    expect(res.body).toHaveProperty("code", code);
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

// Mainnet has no fixtures, since deploying there needs an invite code and real
// fees. These cases only read the public USDCx fee faucet.
const MAINNET_FAUCET_ID = "0xe69e6ca6e39df1b10c1e5399399feb";
const MAINNET_FAUCET_ADDRESS =
  "mm1arnfum9xuwwlrvgvrefejwvlavn3vk24_qr7qqq9wr6w";

describe("GET /:networkId/import/:resourceId across networks", () => {
  it("imports a Mainnet account", async () => {
    const res = await api.get(`/mm/import/${MAINNET_FAUCET_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
    expect(res.body.code).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("imports a Mainnet account by its address", async () => {
    const res = await api.get(`/mm/import/${MAINNET_FAUCET_ADDRESS}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
  });

  it("returns 404 for an address on another network", async () => {
    const res = await api.get(`/mtst/import/${MAINNET_FAUCET_ADDRESS}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(
      /network ID of resource \(mm\) does not match provided network ID \(mtst\)/,
    );
  });

  it("returns 404 for a network it doesn't serve", async () => {
    const res = await api.get(`/mxx/import/${MAINNET_FAUCET_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unsupported network ID `mxx`/);
  });
});

describe("GET /:networkId/import/:resourceId with a faked miden-import", () => {
  const app = express().use(importRouter).use(errorHandler);
  useFakeTool("miden-import", FAKE_MIDEN_IMPORT);

  it("answers what it imported", async () => {
    const res = await request(app).get("/mtst/import/ok");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "note", code: "0x01" });
  });

  it("returns 404 when the tool rejects the request", async () => {
    const res = await request(app).get("/mtst/import/missing");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "account with id missing not found on the network",
    });
  });

  it("returns 502 when the tool fails", async () => {
    const res = await request(app).get("/mtst/import/broken");

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/^rpc error/);
  });
});
