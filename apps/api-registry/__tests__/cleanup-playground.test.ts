import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db from "../src/db/index.js";
import {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "../src/db/schema.js";
import {
  cleanupPlaygroundResources,
  PLAYGROUND_SOURCE,
} from "../src/lib/cleanup-playground.js";
import {
  createFsMaspStore,
  type MaspStore,
} from "../src/storage/masp-store.js";

// Runs the cleanup in-process, against the local database and an fs store.

const NOW = new Date("2026-10-20T12:00:00Z");
const OLD = new Date("2026-10-19T11:00:00Z"); // 25 h before NOW
const RECENT = new Date("2026-10-19T13:00:00Z"); // 23 h before NOW

const hex = (byte: string) => `0x${byte.repeat(32)}`;

const firstId = ([row]: { id: string }[]) => {
  if (!row) {
    throw new Error("insert failed");
  }
  return row.id;
};

const insertPackage = async (maspStore: MaspStore, commitment: string) => {
  await maspStore.put(commitment, Buffer.from("release"));
  await maspStore.put(commitment, Buffer.from("debug"), "debug");
  const rows = await db
    .insert(packagesTable)
    .values({ commitment, debugCommitment: hex("ff") })
    .returning({ id: packagesTable.id });
  return firstId(rows);
};

const insertAccount = async (code: string) => {
  const rows = await db
    .insert(verifiedAccountCodeTable)
    .values({ networkId: "mtst", code })
    .returning({ id: verifiedAccountCodeTable.id });
  return firstId(rows);
};

const insertComponent = (
  verifiedAccountId: string,
  packageId: string,
  source: string,
  createdAt: Date,
) =>
  db.insert(verifiedAccountComponentTable).values({
    verifiedAccountId,
    packageId,
    source,
    createdAt,
  });

const insertNote = (
  script: string,
  packageId: string,
  source: string,
  createdAt: Date,
) =>
  db.insert(verifiedNoteScriptTable).values({
    networkId: "mtst",
    script,
    packageId,
    source,
    createdAt,
  });

const ids = async () => ({
  packages: (await db.select().from(packagesTable)).map((p) => p.commitment),
  accounts: (await db.select().from(verifiedAccountCodeTable)).map(
    (a) => a.code,
  ),
  components: (await db.select().from(verifiedAccountComponentTable)).length,
  notes: (await db.select().from(verifiedNoteScriptTable)).map((n) => n.script),
});

describe("cleanupPlaygroundResources", () => {
  let dir: string;
  let maspStore: MaspStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    maspStore = createFsMaspStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("deletes old playground verifications and what only they used", async () => {
    // An old playground account, alone with its package.
    const oldAccount = await insertAccount(hex("01"));
    const oldPackage = await insertPackage(maspStore, hex("a1"));
    await insertComponent(oldAccount, oldPackage, PLAYGROUND_SOURCE, OLD);
    // An old playground note, alone with its package.
    const notePackage = await insertPackage(maspStore, hex("a2"));
    await insertNote(hex("02"), notePackage, PLAYGROUND_SOURCE, OLD);

    const result = await cleanupPlaygroundResources({ maspStore, now: NOW });

    expect(result).toEqual({
      verifiedAccountComponents: 1,
      verifiedAccounts: 1,
      verifiedNotes: 1,
      packages: 2,
      masps: 2,
    });
    expect(await ids()).toEqual({
      packages: [],
      accounts: [],
      components: 0,
      notes: [],
    });
    for (const commitment of [hex("a1"), hex("a2")]) {
      expect(await maspStore.get(commitment)).toBeNull();
      expect(await maspStore.get(commitment, "debug")).toBeNull();
    }
  });

  it("keeps recent ones, other sources', and anything still shared", async () => {
    // A recent playground account.
    const recentAccount = await insertAccount(hex("01"));
    const recentPackage = await insertPackage(maspStore, hex("a1"));
    await insertComponent(
      recentAccount,
      recentPackage,
      PLAYGROUND_SOURCE,
      RECENT,
    );
    // An old account another client verified.
    const otherAccount = await insertAccount(hex("02"));
    const sharedPackage = await insertPackage(maspStore, hex("a2"));
    await insertComponent(otherAccount, sharedPackage, "miden-verify", OLD);
    // An old playground account sharing that package, and with a second
    // component another client verified.
    const mixedAccount = await insertAccount(hex("03"));
    const playgroundPackage = await insertPackage(maspStore, hex("a3"));
    await insertComponent(mixedAccount, sharedPackage, PLAYGROUND_SOURCE, OLD);
    await insertComponent(mixedAccount, playgroundPackage, "web-verifier", OLD);
    // An old note another client verified.
    const notePackage = await insertPackage(maspStore, hex("a4"));
    await insertNote(hex("04"), notePackage, "unknown", OLD);

    const result = await cleanupPlaygroundResources({ maspStore, now: NOW });

    expect(result).toEqual({
      verifiedAccountComponents: 1,
      verifiedAccounts: 0,
      verifiedNotes: 0,
      packages: 0,
      masps: 0,
    });
    const after = await ids();
    expect(after.accounts.sort()).toEqual([hex("01"), hex("02"), hex("03")]);
    expect(after.packages.sort()).toEqual([
      hex("a1"),
      hex("a2"),
      hex("a3"),
      hex("a4"),
    ]);
    expect(after.components).toBe(3);
    expect(after.notes).toEqual([hex("04")]);
    expect(await maspStore.get(hex("a2"))).not.toBeNull();
  });

  it("keeps an artifact another package row still has", async () => {
    // Two rows with the same commitment: an old playground one, and one
    // another client verified.
    const account = await insertAccount(hex("01"));
    const playgroundPackage = await insertPackage(maspStore, hex("a1"));
    await insertComponent(account, playgroundPackage, PLAYGROUND_SOURCE, OLD);
    const otherAccount = await insertAccount(hex("02"));
    const otherPackage = await insertPackage(maspStore, hex("a1"));
    await insertComponent(otherAccount, otherPackage, "miden-verify", OLD);

    const result = await cleanupPlaygroundResources({ maspStore, now: NOW });

    expect(result).toMatchObject({ packages: 1, masps: 0 });
    expect(await maspStore.get(hex("a1"))).not.toBeNull();
    expect(await maspStore.get(hex("a1"), "debug")).not.toBeNull();
  });
});
