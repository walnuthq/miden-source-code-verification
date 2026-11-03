import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "miden-source-code-verification-test-utils";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const warmCargoLock = path.resolve(
  __dirname,
  "../examples/counter-contract/counter-contract/Cargo.lock",
);

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("GET /lockfile", () => {
  it("serves the lockfile the image warmed its cache with", async () => {
    const res = await api.get("/lockfile");

    expect(res.status).toBe(200);
    expect(res.text).toBe(await readFile(warmCargoLock, "utf-8"));
  });
});
