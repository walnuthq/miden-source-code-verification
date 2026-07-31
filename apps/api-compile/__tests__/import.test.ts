import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  accounts,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
} from "./data";

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("GET /:networkId/import/:resourceId", () => {
  it("imports an on-chain account", async () => {
    const res = await api.get(`/mtst/import/${COUNTER_CONTRACT_ID_1}`);

    const { code } = accounts[COUNTER_CONTRACT_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "account");
    expect(res.body).toHaveProperty("code", code);
  });

  it("imports an on-chain note", async () => {
    const res = await api.get(`/mtst/import/${COUNTER_NOTE_ID_1}`);

    const { code } = notes[COUNTER_NOTE_ID_1];

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("type", "note");
    expect(res.body).toHaveProperty("code", code);
  });

  it("returns 404 for an account not found on the given network", async () => {
    const res = await api.get(`/mdev/import/${COUNTER_CONTRACT_ID_1}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a note not found on the given network", async () => {
    const res = await api.get(`/mdev/import/${COUNTER_NOTE_ID_1}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});
