import {
  accounts,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
} from "miden-source-code-verification-test-utils";
import request from "supertest";
import { describe, expect, it } from "vitest";

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

const otherNetworkId = "mlcl";

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

  it("returns 404 for an account not found on the given network", async () => {
    const res = await api.get(
      `/${otherNetworkId}/import/${COUNTER_CONTRACT_ID_1}`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a note not found on the given network", async () => {
    const res = await api.get(`/${otherNetworkId}/import/${COUNTER_NOTE_ID_1}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});
