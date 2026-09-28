import request from "supertest";
import { describe, expect, it } from "vitest";

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("errors raised outside the routes", () => {
  it("answers JSON for a body that isn't valid JSON", async () => {
    const res = await api
      .post("/compile")
      .set("Content-Type", "application/json")
      .send('{"files":');

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "request body is not valid JSON" });
  });

  it("answers JSON for a body over 1 MB", async () => {
    const res = await api
      .post("/compile")
      .send({ files: { "src/lib.rs": "x".repeat(1_100_000) } });

    expect(res.status).toBe(413);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "request body is larger than 1 MB" });
  });

  it("answers JSON for an unknown path", async () => {
    const res = await api.get("/nope");

    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "not found" });
  });
});
