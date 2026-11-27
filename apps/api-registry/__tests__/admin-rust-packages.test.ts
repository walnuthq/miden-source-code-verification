import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request } from "miden-source-code-verification-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFsMaspStore } from "../src/storage/masp-store.ts";
import { fakeApiCompile } from "./fake-api-compile.ts";

// The admin routes in-process, against the local database (truncated before
// each test by setup.ts). `ADMIN_TOKEN` is read when the app's modules load,
// so it is set before they are imported.
const TOKEN = "test-admin-token";
process.env.ADMIN_TOKEN = TOKEN;
const { createApp } = await import("../src/app.ts");

describe("the Rust package admin routes", () => {
  let dir: string;
  let app: ReturnType<typeof request>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    app = request(createApp({ maspStore: createFsMaspStore(dir), apiCompile: fakeApiCompile() }));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const auth = ["Authorization", `Bearer ${TOKEN}`] as const;

  it("want the admin token", async () => {
    const list = await app.get("/admin/rust-packages");
    expect(list.status).toBe(401);
    const deletion = await app
      .post("/admin/rust-packages/delete")
      .set("Authorization", "Bearer wrong")
      .send({});
    expect(deletion.status).toBe(401);
  });

  it("list nothing and delete nothing in an empty registry", async () => {
    const list = await app.get("/admin/rust-packages").set(...auth);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      networks: {},
      packages: [],
      files: [],
      counts: { packages: 0, verifiedAccounts: 0, verifiedNotes: 0, files: 0 },
    });
    const deletion = await app
      .post("/admin/rust-packages/delete")
      .set(...auth)
      .send({});
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({
      packages: 0,
      verifiedAccounts: 0,
      verifiedNotes: 0,
      remaining: 0,
    });
  });

  it("refuses a limit outside 1 to 200", async () => {
    for (const limit of [0, 201, 1.5, "10"]) {
      const res = await app
        .post("/admin/rust-packages/delete")
        .set(...auth)
        .send({ limit });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "limit must be an integer from 1 to 200" });
    }
  });
});
