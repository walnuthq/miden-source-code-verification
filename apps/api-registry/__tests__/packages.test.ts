import request from "supertest";
import { describe, expect, it } from "vitest";

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

// A well-formed commitment no package is ever compiled to in these tests.
const UNKNOWN_COMMITMENT =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

describe("GET /:networkId/packages/masp/:packageCommitment.masp", () => {
  it("returns 404 for a commitment absent from the registry", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}.masp`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package masp not found");
  });

  it("rejects a file name that isn't a commitment", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/counter-contract.masp`)
      .send();
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });

  it("rejects a commitment without the .masp extension", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}`)
      .send();
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });
});
