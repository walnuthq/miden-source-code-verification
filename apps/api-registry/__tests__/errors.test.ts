import request from "supertest";
import { describe, expect, it } from "vitest";

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const api = request(apiUrl);

const networkId = process.env.NETWORK_ID ?? "mtst";

describe("errors raised outside the routes", () => {
  it("answers JSON for a body that isn't valid JSON", async () => {
    const res = await api
      .post(`/v1/${networkId}/verified-accounts`)
      .set("Content-Type", "application/json")
      .send('{"files":');

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "request body is not valid JSON" });
  });

  it("answers JSON for a body over 1 MB", async () => {
    const res = await api.post(`/v1/${networkId}/verified-accounts`).send({
      accountId: "0x1",
      files: { "src/lib.rs": "x".repeat(1_100_000) },
    });

    expect(res.status).toBe(413);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "request body is larger than 1 MB" });
  });

  it("answers JSON for an unknown path", async () => {
    const res = await api.get("/v1/nope");

    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "not found" });
  });
});
