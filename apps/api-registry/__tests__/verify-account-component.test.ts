import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPackage } from "../src/db/packages.js";
import { ApiCompileError, fetchApiCompile } from "../src/lib/api-compile.js";
import type { DebugBuild } from "../src/lib/debug-build.js";
import { importResource } from "../src/lib/import-resource.js";
import { verifyAccountComponent } from "../src/lib/verify-account-component.js";
import {
  createFsMaspStore,
  type MaspStore,
} from "../src/storage/masp-store.js";

// Runs the verification in-process, against the local database, with
// api-compile and the on-chain import mocked: the only way to see how a debug
// build that fails, or is missing, is handled.
vi.mock("../src/lib/api-compile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api-compile.js")>()),
  fetchApiCompile: vi.fn(),
}));
vi.mock("../src/lib/import-resource.js", () => ({ importResource: vi.fn() }));

const COMMITMENT = `0x${"aa".repeat(32)}`;
const DEBUG_COMMITMENT = `0x${"bb".repeat(32)}`;
const files = {
  "Cargo.toml": '[package]\nname = "counter-contract"\n',
  "miden-project.toml": "",
};

const mockApiCompile = (debug: DebugBuild | undefined) =>
  vi.mocked(fetchApiCompile).mockResolvedValueOnce({
    verified: true,
    masp: Buffer.from("release").toString("base64"),
    commitment: COMMITMENT,
    kind: "account-component",
    manifest: { exports: [], dependencies: [] },
    files,
    cargoMidenVersion: "0.11.0",
    debug,
  });

const debugBuild: DebugBuild = {
  masp: Buffer.from("debug").toString("base64"),
  commitment: DEBUG_COMMITMENT,
  manifest: { exports: [], dependencies: [] },
  cargoMidenVersion: "0.11.0",
};

// Each account its own code, so each verification is a new component.
const verify = (maspStore: MaspStore, code: string) => {
  vi.mocked(importResource).mockResolvedValueOnce({
    type: "account",
    code,
  } as Awaited<ReturnType<typeof importResource>>);
  return verifyAccountComponent({
    networkId: "mtst",
    accountId: "0x858c680a7a66d2916230cc8c2a6c98",
    files,
    maspStore,
  });
};

describe("verifyAccountComponent with a debug build", () => {
  let dir: string;
  let maspStore: MaspStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    maspStore = createFsMaspStore(dir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("stores it next to the release build", async () => {
    mockApiCompile(debugBuild);

    expect(await verify(maspStore, `0x${"01".repeat(32)}`)).toBe(true);

    const dbPackage = await getPackage(COMMITMENT);
    expect(dbPackage).toMatchObject({
      entrypoint: ".",
      builtWith: "0.11.0",
      debugCommitment: DEBUG_COMMITMENT,
      debugBuiltWith: "0.11.0",
    });
    expect(
      Buffer.from((await maspStore.get(COMMITMENT, "debug")) ?? []).toString(),
    ).toBe("debug");
    expect(
      Buffer.from((await maspStore.get(COMMITMENT)) ?? []).toString(),
    ).toBe("release");
  });

  it("still verifies when it failed", async () => {
    mockApiCompile({ error: "debug build exports differ" });

    expect(await verify(maspStore, `0x${"01".repeat(32)}`)).toBe(true);

    expect(await getPackage(COMMITMENT)).toMatchObject({
      debugCommitment: null,
    });
    expect(await maspStore.get(COMMITMENT, "debug")).toBeNull();
    expect(await maspStore.get(COMMITMENT)).not.toBeNull();
  });

  it("still verifies with an api-compile that doesn't build it", async () => {
    mockApiCompile(undefined);

    expect(await verify(maspStore, `0x${"01".repeat(32)}`)).toBe(true);

    expect(await getPackage(COMMITMENT)).toMatchObject({
      debugCommitment: null,
    });
  });

  it("adds it to a package stored without one", async () => {
    mockApiCompile({ error: "debug build too large" });
    await verify(maspStore, `0x${"01".repeat(32)}`);
    expect(await getPackage(COMMITMENT)).toMatchObject({
      debugCommitment: null,
    });

    mockApiCompile(debugBuild);
    expect(await verify(maspStore, `0x${"02".repeat(32)}`)).toBe(true);

    expect(await getPackage(COMMITMENT)).toMatchObject({
      debugCommitment: DEBUG_COMMITMENT,
    });
    expect(await maspStore.get(COMMITMENT, "debug")).not.toBeNull();
  });
});

describe("verifyAccountComponent when api-compile fails", () => {
  it("fails with the status of a /verify that may pass on a retry", async () => {
    vi.mocked(importResource).mockClear();
    const failure = new ApiCompileError("rpc error: request timed out", 502);
    vi.mocked(fetchApiCompile).mockRejectedValueOnce(failure);

    await expect(
      verifyAccountComponent({
        networkId: "mtst",
        accountId: "0x858c680a7a66d2916230cc8c2a6c98",
        files,
        maspStore: createFsMaspStore(join(tmpdir(), "unused-masp-store")),
      }),
    ).rejects.toBe(failure);
    expect(importResource).not.toHaveBeenCalled();
  });
});

describe("verifyAccountComponent when the import fails", () => {
  it("fails with api-compile's status, which the route passes on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    try {
      mockApiCompile(undefined);
      const failure = new ApiCompileError("rpc error: request timed out", 502);
      vi.mocked(importResource).mockRejectedValueOnce(failure);

      await expect(
        verifyAccountComponent({
          networkId: "mtst",
          accountId: "0x858c680a7a66d2916230cc8c2a6c98",
          files,
          maspStore: createFsMaspStore(dir),
        }),
      ).rejects.toBe(failure);
      // Nothing was recorded for a resource that couldn't be looked up.
      expect(await getPackage(COMMITMENT)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
