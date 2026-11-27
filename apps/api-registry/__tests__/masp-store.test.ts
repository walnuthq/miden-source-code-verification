import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsMaspStore, debugMaspKey } from "../src/storage/masp-store.ts";

const COMMITMENT = "0xd4ae21452bf89eec3d7156eb9ae870f07c792bf8526329631492ff7ee9862b9d";

describe("createFsMaspStore", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores, reads and deletes an artifact", async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    const store = createFsMaspStore(join(dir, "masp"));
    expect(await store.get(COMMITMENT)).toBeNull();

    await store.put(COMMITMENT, new Uint8Array([1]));
    expect([...((await store.get(COMMITMENT)) ?? [])]).toEqual([1]);

    await store.delete(COMMITMENT);
    expect(await store.get(COMMITMENT)).toBeNull();
    // Deleting what isn't there is no error.
    await store.delete(COMMITMENT);
  });

  it("deletes the debug build stored next to an artifact", async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    const store = createFsMaspStore(dir);
    await store.put(COMMITMENT, new Uint8Array([1]));
    await writeFile(join(dir, debugMaspKey(COMMITMENT)), new Uint8Array([2]));

    await store.delete(COMMITMENT);

    expect(await readdir(dir)).toEqual([]);
  });
});
