import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFsMaspStore,
  maspKey,
  parseMaspKey,
} from "../src/storage/masp-store.js";

const COMMITMENT =
  "0xd4ae21452bf89eec3d7156eb9ae870f07c792bf8526329631492ff7ee9862b9d";

describe("maspKey / parseMaspKey", () => {
  it("round-trips both variants", () => {
    for (const variant of ["release", "debug"] as const) {
      expect(parseMaspKey(maspKey(COMMITMENT, variant))).toEqual({
        commitment: COMMITMENT,
        variant,
      });
    }
  });

  it("names the release build by default, and the debug one with .debug", () => {
    expect(maspKey(COMMITMENT)).toBe(`${COMMITMENT}.masp`);
    expect(maspKey(COMMITMENT, "debug")).toBe(`${COMMITMENT}.debug.masp`);
  });

  it("matches case-insensitively and lowercases the commitment", () => {
    const upper = `0x${COMMITMENT.slice(2).toUpperCase()}`;
    expect(maspKey(upper)).toBe(`${COMMITMENT}.masp`);
    expect(parseMaspKey(`${upper}.DEBUG.MASP`)).toEqual({
      commitment: COMMITMENT,
      variant: "debug",
    });
  });

  it("rejects anything else", () => {
    for (const key of [
      "counter-contract.masp",
      COMMITMENT,
      `${COMMITMENT}.release.masp`,
      `${COMMITMENT}.debug`,
      `${COMMITMENT.slice(0, -2)}.masp`,
    ]) {
      expect(parseMaspKey(key)).toBeNull();
    }
  });
});

describe("createFsMaspStore", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the release and debug builds apart", async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    const store = createFsMaspStore(join(dir, "masp"));
    expect(await store.get(COMMITMENT)).toBeNull();
    expect(await store.get(COMMITMENT, "debug")).toBeNull();

    await store.put(COMMITMENT, new Uint8Array([1]));
    expect(await store.get(COMMITMENT, "debug")).toBeNull();
    await store.put(COMMITMENT, new Uint8Array([2]), "debug");

    expect([...((await store.get(COMMITMENT)) ?? [])]).toEqual([1]);
    expect([...((await store.get(COMMITMENT, "release")) ?? [])]).toEqual([1]);
    expect([...((await store.get(COMMITMENT, "debug")) ?? [])]).toEqual([2]);
  });
});
