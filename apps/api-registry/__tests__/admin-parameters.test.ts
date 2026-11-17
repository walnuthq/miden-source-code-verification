import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "miden-source-code-verification-test-utils";
import type { PackageMetadataResponse } from "miden-source-code-verification-utils/api-compile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import db from "../src/db/index.ts";
import { getPackage } from "../src/db/packages.ts";
import { packagesTable } from "../src/db/schema.ts";
import { type ApiCompile, ApiCompileError } from "../src/lib/api-compile.ts";
import {
  createFsMaspStore,
  type MaspStore,
} from "../src/storage/masp-store.ts";
import { fakeApiCompile } from "./fake-api-compile.ts";

// The parameters backfill's routes in-process, with api-compile faked: the
// only way to see what they do with an answer for another package, with a
// package api-compile can't read, or with a WIT it couldn't parse.

const ADMIN_TOKEN = "test-admin-token";
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  ADMIN_TOKEN: "test-admin-token",
}));

const COMMITMENT = `0x${"ab".repeat(32)}`;

const PARAMETERS = {
  '::"miden:bank-account/bank@0.1.0"::deposit': [
    { name: "depositor", type: "account-id" },
    { name: "deposit-asset", type: "asset" },
  ],
};

const metadata = (commitment: string): PackageMetadataResponse => ({
  commitment,
  kind: "account-component",
  manifest: { exports: [], dependencies: [] },
  readOnly: {},
  callsForeign: {},
});

describe("parameters backfill", () => {
  let dir: string;
  let maspStore: MaspStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    maspStore = createFsMaspStore(dir);
    // A package stored before the registry kept its parameters.
    await maspStore.put(COMMITMENT, Buffer.from("release"));
    await db
      .insert(packagesTable)
      .values({ commitment: COMMITMENT, readOnly: {}, schemas: {} });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const app = (packageMetadata: ApiCompile["packageMetadata"]) =>
    request(
      createApp({ maspStore, apiCompile: fakeApiCompile({ packageMetadata }) }),
    );

  const backfill = (packageMetadata: ApiCompile["packageMetadata"]) =>
    app(packageMetadata)
      .post(`/admin/packages/${COMMITMENT}/parameters`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

  const pending = () =>
    app(() => Promise.reject(new Error("not expected")))
      .get("/admin/parameters/pending")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

  it("rejects requests without the admin token", async () => {
    const res = await app(() => Promise.reject(new Error("not expected")))
      .get("/admin/parameters/pending")
      .set("Authorization", "Bearer wrong")
      .send();
    expect(res.status).toBe(401);
  });

  it("sends the stored masp and records what api-compile read", async () => {
    expect((await pending()).body).toEqual([
      expect.objectContaining({ commitment: COMMITMENT }),
    ]);
    const sent: Uint8Array[] = [];
    const res = await backfill(async (masp) => {
      sent.push(masp);
      return { ...metadata(COMMITMENT), parameters: PARAMETERS };
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parameters: PARAMETERS });
    expect(sent.map((masp) => Buffer.from(masp).toString())).toEqual([
      "release",
    ]);
    expect(await getPackage(COMMITMENT)).toHaveProperty(
      "parameters",
      PARAMETERS,
    );
    expect((await pending()).body).toEqual([]);
  });

  it("answers what a package already has without reading it again", async () => {
    await backfill(async () => ({
      ...metadata(COMMITMENT),
      parameters: PARAMETERS,
    }));

    const res = await backfill(() => Promise.reject(new Error("not expected")));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parameters: PARAMETERS });
  });

  it("records `{}` for a package without a WIT", async () => {
    const res = await backfill(async () => ({
      ...metadata(COMMITMENT),
      parameters: {},
    }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parameters: {} });
    expect(await getPackage(COMMITMENT)).toHaveProperty("parameters", {});
  });

  it("records `{}`, and says so, when api-compile couldn't read the WIT", async () => {
    const res = await backfill(async () => metadata(COMMITMENT));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parameters: {}, unreadable: true });
    expect(await getPackage(COMMITMENT)).toHaveProperty("parameters", {});
  });

  it("answers 409, and records nothing, when the masp is another package", async () => {
    const other = `0x${"cd".repeat(32)}`;
    const res = await backfill(async () => metadata(other));

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty(
      "error",
      `stored masp has commitment ${other}`,
    );
    expect(await getPackage(COMMITMENT)).toHaveProperty("parameters", null);
  });

  it("passes on api-compile's 400 for a package it can't read", async () => {
    const res = await backfill(async () => {
      throw new ApiCompileError("failed to parse package", 400);
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "failed to parse package");
    expect(await getPackage(COMMITMENT)).toHaveProperty("parameters", null);
  });

  it("answers 400 for a commitment that isn't one", async () => {
    const res = await app(() => Promise.reject(new Error("not expected")))
      .post("/admin/packages/0x1234/parameters")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });

  it("answers 404 when the package's masp isn't stored", async () => {
    await maspStore.delete(COMMITMENT);
    const res = await backfill(() => Promise.reject(new Error("not expected")));

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package masp not found");
    expect(await getPackage(COMMITMENT)).toHaveProperty("parameters", null);
  });

  it("answers 404 for an unknown package", async () => {
    const res = await app(() => Promise.reject(new Error("not expected")))
      .post(`/admin/packages/0x${"11".repeat(32)}/parameters`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package not found");
  });
});
