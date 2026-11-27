import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isStoredRustProject } from "miden-source-code-verification-utils/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import db from "../src/db/index.ts";
import {
  packagesTable,
  verifiedAccountCodeTable,
  verifiedAccountComponentTable,
  verifiedNoteScriptTable,
} from "../src/db/schema.ts";
import {
  deleteRustPackages,
  listRustPackages,
  rustPackageCondition,
} from "../src/lib/rust-packages.ts";
import { createFsMaspStore, debugMaspKey, type MaspStore } from "../src/storage/masp-store.ts";

// Runs the deletion in-process, against the local database (truncated before
// each test by setup.ts) and an fs store: never against production.

const hex = (byte: string) => `0x${byte.repeat(32)}`;

const firstId = ([row]: { id: string }[]) => {
  if (!row) {
    throw new Error("insert failed");
  }
  return row.id;
};

type StoredPackage = { id: string; commitment: string };

// A package row and its stored files: a Rust one with a debug build when
// `debug` is set, as the registry kept them before debug builds were retired.
const insertPackage = async (
  maspStore: MaspStore,
  dir: string,
  {
    commitment,
    name,
    files,
    entrypoint,
    debug = false,
  }: {
    commitment: string;
    name: string;
    files: Record<string, string>;
    entrypoint: string | null;
    debug?: boolean;
  },
): Promise<StoredPackage> => {
  await maspStore.put(commitment, Buffer.from(name));
  if (debug) {
    await writeFile(join(dir, debugMaspKey(commitment)), "debug");
  }
  const rows = await db
    .insert(packagesTable)
    .values({
      name,
      commitment,
      files,
      entrypoint,
      debugCommitment: debug ? hex("ff") : null,
      readOnly: {},
      parameters: {},
    })
    .returning({ id: packagesTable.id });
  return { id: firstId(rows), commitment };
};

const insertAccount = async (networkId: string, code: string, packages: StoredPackage[]) => {
  const verifiedAccountId = firstId(
    await db
      .insert(verifiedAccountCodeTable)
      .values({ networkId, code })
      .returning({ id: verifiedAccountCodeTable.id }),
  );
  for (const { id: packageId, commitment: packageCommitment } of packages) {
    await db
      .insert(verifiedAccountComponentTable)
      .values({ verifiedAccountId, packageId, packageCommitment });
  }
};

const insertNote = (networkId: string, script: string, { id, commitment }: StoredPackage) =>
  db.insert(verifiedNoteScriptTable).values({
    networkId,
    script,
    packageId: id,
    packageCommitment: commitment,
  });

const RUST_ROOT = hex("a1");
const RUST_SUBDIR = hex("a2");
const RUST_NO_ENTRYPOINT = hex("a3");
const RUST_UNUSED = hex("a4");
const MASM_ROOT = hex("b1");
const MASM_IN_WORKSPACE = hex("b2");
const MASM_MIXED = hex("b3");

const cargoToml = (name: string) => `[package]\nname = "${name}"\n`;
const midenProjectToml = (name: string) => `[package]\nname = "${name}"\nversion = "0.1.0"\n`;

// Both kinds of rows, on three networks: a Rust account, a Rust note on two
// networks, an account with a Rust and a MASM component, MASM records, and a
// Rust package nothing points at.
const seed = async (maspStore: MaspStore, dir: string) => {
  const rustRoot = await insertPackage(maspStore, dir, {
    commitment: RUST_ROOT,
    name: "counter-contract",
    files: { "Cargo.toml": cargoToml("counter-contract"), "src/lib.rs": "" },
    entrypoint: ".",
    debug: true,
  });
  const rustSubdir = await insertPackage(maspStore, dir, {
    commitment: RUST_SUBDIR,
    name: "counter-note",
    files: {
      "counter-note/Cargo.toml": cargoToml("counter-note"),
      "counter-note/src/lib.rs": "",
      "counter-contract/Cargo.toml": cargoToml("counter-contract"),
    },
    entrypoint: "counter-note",
  });
  const rustNoEntrypoint = await insertPackage(maspStore, dir, {
    commitment: RUST_NO_ENTRYPOINT,
    name: "bank",
    files: { "Cargo.toml": cargoToml("bank") },
    entrypoint: null,
    debug: true,
  });
  await insertPackage(maspStore, dir, {
    commitment: RUST_UNUSED,
    name: "wallet",
    files: { "Cargo.toml": cargoToml("wallet") },
    entrypoint: ".",
  });
  const masmRoot = await insertPackage(maspStore, dir, {
    commitment: MASM_ROOT,
    name: "counter-contract",
    files: { "miden-project.toml": midenProjectToml("counter-contract") },
    entrypoint: ".",
  });
  // A Cargo.toml elsewhere than the entrypoint doesn't make it Rust.
  const masmInWorkspace = await insertPackage(maspStore, dir, {
    commitment: MASM_IN_WORKSPACE,
    name: "counter-note",
    files: {
      "Cargo.toml": "[workspace]\n",
      "counter-note/miden-project.toml": midenProjectToml("counter-note"),
    },
    entrypoint: "counter-note",
  });
  const masmMixed = await insertPackage(maspStore, dir, {
    commitment: MASM_MIXED,
    name: "auth",
    files: { "auth/miden-project.toml": midenProjectToml("auth") },
    entrypoint: "auth",
  });

  await insertAccount("mtst", hex("01"), [rustRoot]);
  await insertAccount("mdev", hex("02"), [rustNoEntrypoint, masmMixed]);
  await insertAccount("mtst", hex("03"), [masmRoot]);
  await insertNote("mtst", hex("04"), rustSubdir);
  await insertNote("mm", hex("04"), rustSubdir);
  await insertNote("mtst", hex("05"), masmInWorkspace);
};

const remaining = async () => ({
  packages: (await db.select().from(packagesTable)).map((p) => p.commitment).sort(),
  accounts: (await db.select().from(verifiedAccountCodeTable)).map((a) => a.code).sort(),
  components: (await db.select().from(verifiedAccountComponentTable))
    .map((c) => c.packageCommitment)
    .sort(),
  notes: (await db.select().from(verifiedNoteScriptTable))
    .map((n) => `${n.networkId}:${n.script}`)
    .sort(),
});

describe("the deletion of Rust packages", () => {
  let dir: string;
  let maspStore: MaspStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "masp-store-"));
    maspStore = createFsMaspStore(dir);
    await seed(maspStore, dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("selects in SQL the rows isStoredRustProject calls Rust", async () => {
    const rows = await db.select().from(packagesTable);
    const rust = await db
      .select({ commitment: packagesTable.commitment })
      .from(packagesTable)
      .where(rustPackageCondition);
    expect(rust.map((row) => row.commitment).sort()).toEqual(
      rows
        .filter((row) => isStoredRustProject(row.files, row.entrypoint))
        .map((row) => row.commitment)
        .sort(),
    );
    expect(rust).toHaveLength(4);
  });

  it("lists per network what would go, and deletes nothing in a dry run", async () => {
    const before = await remaining();
    const files = (await readdir(dir)).sort();

    const report = await listRustPackages();

    expect(report.counts).toEqual({
      packages: 4,
      verifiedAccounts: 2,
      verifiedNotes: 2,
      files: 6,
    });
    expect(report.networks).toEqual({
      mtst: {
        packages: [RUST_ROOT, RUST_SUBDIR],
        verifiedAccounts: [hex("01")],
        mixedAccounts: [],
        verifiedNotes: [hex("04")],
      },
      mdev: {
        packages: [RUST_NO_ENTRYPOINT],
        verifiedAccounts: [hex("02")],
        mixedAccounts: [hex("02")],
        verifiedNotes: [],
      },
      mm: {
        packages: [RUST_SUBDIR],
        verifiedAccounts: [],
        mixedAccounts: [],
        verifiedNotes: [hex("04")],
      },
    });
    expect(report.packages).toEqual([
      { commitment: RUST_ROOT, name: "counter-contract" },
      { commitment: RUST_SUBDIR, name: "counter-note" },
      { commitment: RUST_NO_ENTRYPOINT, name: "bank" },
      { commitment: RUST_UNUSED, name: "wallet" },
    ]);
    expect(report.files).toEqual([
      `${RUST_ROOT}.masp`,
      `${RUST_ROOT}.debug.masp`,
      `${RUST_SUBDIR}.masp`,
      `${RUST_NO_ENTRYPOINT}.masp`,
      `${RUST_NO_ENTRYPOINT}.debug.masp`,
      `${RUST_UNUSED}.masp`,
    ]);

    expect(await remaining()).toEqual(before);
    expect((await readdir(dir)).sort()).toEqual(files);
  });

  it("deletes the Rust packages, what points at them and their files, in batches", async () => {
    const first = await deleteRustPackages({ maspStore, limit: 3 });
    expect(first).toMatchObject({ packages: 3, remaining: 1 });
    const second = await deleteRustPackages({ maspStore, limit: 3 });
    expect(second).toMatchObject({ packages: 1, remaining: 0 });
    expect({
      verifiedAccounts: first.verifiedAccounts + second.verifiedAccounts,
      verifiedNotes: first.verifiedNotes + second.verifiedNotes,
    }).toEqual({ verifiedAccounts: 2, verifiedNotes: 2 });

    // The mixed account goes whole; its MASM package stays.
    expect(await remaining()).toEqual({
      packages: [MASM_ROOT, MASM_IN_WORKSPACE, MASM_MIXED].sort(),
      accounts: [hex("03")],
      components: [MASM_ROOT],
      notes: [`mtst:${hex("05")}`],
    });
    expect((await readdir(dir)).sort()).toEqual(
      [`${MASM_ROOT}.masp`, `${MASM_IN_WORKSPACE}.masp`, `${MASM_MIXED}.masp`].sort(),
    );
    expect((await listRustPackages()).counts).toEqual({
      packages: 0,
      verifiedAccounts: 0,
      verifiedNotes: 0,
      files: 0,
    });
  });

  it("finds nothing to delete when run again", async () => {
    await deleteRustPackages({ maspStore, limit: 50 });
    const after = await remaining();

    expect(await deleteRustPackages({ maspStore, limit: 50 })).toEqual({
      packages: 0,
      verifiedAccounts: 0,
      verifiedNotes: 0,
      remaining: 0,
    });
    expect(await remaining()).toEqual(after);
  });
});
