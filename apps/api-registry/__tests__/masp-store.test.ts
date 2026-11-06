import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFsMaspStore } from "../src/storage/masp-store.ts";

const COMMITMENT =
  "0xd4ae21452bf89eec3d7156eb9ae870f07c792bf8526329631492ff7ee9862b9d";

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
