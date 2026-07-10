import request from "supertest";
import { describe, expect, it } from "vitest";
import { accounts, notes } from "./data";

const api = request(process.env.API_URL ?? "http://localhost:8080");

const ACCOUNT_ID = "0xa070576e2ee8d311021079d99e1374";
const NOTE_ID =
  "0x5101df16c6b3d79a0e680e4a08c813cbc634e59c51bae4e83b8a8bd69f614160";

// Both the account code root and the note script root serialize to a 32-byte
// word, i.e. a `0x`-prefixed 64-char hex string.
const CODE_HEX = /^0x[0-9a-f]{64}$/;

describe("GET /:networkId/import/:resourceId", () => {
  it("imports an on-chain account", async () => {
    const res = await api.get(`/mtst/import/${ACCOUNT_ID}`);

    const { code } = accounts[ACCOUNT_ID];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
    expect(res.body).toHaveProperty("code", code);
  });

  it("imports an on-chain note", async () => {
    const res = await api.get(`/mtst/import/${NOTE_ID}`);

    const { code } = notes[NOTE_ID];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "note");
    expect(res.body).toHaveProperty("code", code);
  });

  it("returns 404 for an account not found on the given network", async () => {
    const res = await api.get(`/mdev/import/${ACCOUNT_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a note not found on the given network", async () => {
    const res = await api.get(`/mdev/import/${NOTE_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});
