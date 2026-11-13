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

// The schemas backfill's route in-process, with api-compile faked: the only
// way to see what it does with an answer for another package, or with a
// package api-compile can't read.

const ADMIN_TOKEN = "test-admin-token";
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  ADMIN_TOKEN: "test-admin-token",
}));

const COMMITMENT = `0x${"ab".repeat(32)}`;

const metadata = (commitment: string): PackageMetadataResponse => ({
  commitment,
  kind: "account-component",
  manifest: { exports: [], dependencies: [] },
  readOnly: {},
});

describe("POST /admin/packages/:commitment/schemas", () => {
  let dir: string;
  let maspStore: MaspStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    maspStore = createFsMaspStore(dir);
    // A package stored before the registry kept its schemas.
    await maspStore.put(COMMITMENT, Buffer.from("release"));
    await db
      .insert(packagesTable)
      .values({ commitment: COMMITMENT, readOnly: {} });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const backfill = (packageMetadata: ApiCompile["packageMetadata"]) =>
    request(
      createApp({ maspStore, apiCompile: fakeApiCompile({ packageMetadata }) }),
    )
      .post(`/admin/packages/${COMMITMENT}/schemas`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});

  it("sends the stored masp and records what api-compile read", async () => {
    const sent: Uint8Array[] = [];
    const storage = {
      slots: [{ name: "a::b::c", type: "value" as const, valueType: "word" }],
    };
    const res = await backfill(async (masp) => {
      sent.push(masp);
      return { ...metadata(COMMITMENT), storage };
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schemas: { storage } });
    expect(sent.map((masp) => Buffer.from(masp).toString())).toEqual([
      "release",
    ]);
    expect(await getPackage(COMMITMENT)).toHaveProperty("schemas", {
      storage,
    });
  });

  it("answers 409, and records nothing, when the masp is another package", async () => {
    const other = `0x${"cd".repeat(32)}`;
    const res = await backfill(async () => metadata(other));

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty(
      "error",
      `stored masp has commitment ${other}`,
    );
    expect(await getPackage(COMMITMENT)).toHaveProperty("schemas", null);
  });

  it("passes on api-compile's 400 for a package it can't read", async () => {
    const res = await backfill(async () => {
      throw new ApiCompileError("failed to parse package", 400);
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "failed to parse package");
    expect(await getPackage(COMMITMENT)).toHaveProperty("schemas", null);
  });
});
