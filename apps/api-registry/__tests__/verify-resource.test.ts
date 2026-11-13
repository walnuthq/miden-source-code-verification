import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type {
  DebugBuild,
  VerifyResponse,
} from "miden-source-code-verification-utils/api-compile";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { createDb, dbScope } from "../src/db/index.ts";
import { getPackage, updatePackage } from "../src/db/packages.ts";
import {
  verifiedAccountCodeTable,
  verifiedNoteScriptTable,
} from "../src/db/schema.ts";
import { type ApiCompile, ApiCompileError } from "../src/lib/api-compile.ts";
import { findVerifiedRecordByRoot } from "../src/lib/verified-record.ts";
import { type Resource, verifyResource } from "../src/lib/verify-resource.ts";
import {
  createFsMaspStore,
  type MaspStore,
} from "../src/storage/masp-store.ts";
import { fakeApiCompile } from "./fake-api-compile.ts";

// Runs the verification in-process, against the local database, with
// api-compile faked: the only way to see how a debug build that fails, or is
// missing, is handled, and what recording the same root twice does. A
// verification only calls `verify`, which answers the resource's root.

const COMMITMENT = `0x${"aa".repeat(32)}`;
const DEBUG_COMMITMENT = `0x${"bb".repeat(32)}`;
const files = {
  "Cargo.toml": '[package]\nname = "counter-contract"\n',
  "miden-project.toml": "",
};
const project = { files, entrypoint: ".", name: "counter-contract" };

const ACCOUNT: Resource = {
  kind: "account",
  accountId: "0x858c680a7a66d2916230cc8c2a6c98",
};
const NOTE: Resource = { kind: "note", noteId: `0x${"cc".repeat(32)}` };

// Without the root, which each test picks so that its record is its own.
const built = (debug?: DebugBuild): Omit<VerifyResponse, "root"> => ({
  verified: true,
  masp: Buffer.from("release").toString("base64"),
  commitment: COMMITMENT,
  kind: "account-component",
  manifest: { exports: [], dependencies: [] },
  readOnly: {},
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

describe("verifyResource", () => {
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

  const verify = (
    resource: Resource,
    apiCompile: ApiCompile,
    source?: string,
  ) =>
    verifyResource({
      networkId: "mtst",
      resource,
      project,
      source,
      maspStore,
      apiCompile,
    });

  // Each root its own, so each verification is a new record.
  const verifyBuilt = (
    resource: Resource,
    result: Omit<VerifyResponse, "root">,
    root: string,
    source?: string,
  ) =>
    verify(
      resource,
      fakeApiCompile({ verify: async () => ({ ...result, root }) }),
      source,
    );

  // Each on its own connection, as each request is on Cloudflare: the shared
  // pool has one, which would run the two transactions one after the other.
  const onOwnConnection = async <T>(run: () => Promise<T>) => {
    const own = createDb();
    try {
      return await dbScope.run(own, run);
    } finally {
      await own.$client.end();
    }
  };

  describe("with a debug build", () => {
    it("stores it next to the release build", async () => {
      expect(
        await verifyBuilt(ACCOUNT, built(debugBuild), `0x${"01".repeat(32)}`),
      ).toBe(true);

      expect(await getPackage(COMMITMENT)).toMatchObject({
        entrypoint: ".",
        builtWith: "0.11.0",
        debugCommitment: DEBUG_COMMITMENT,
        debugBuiltWith: "0.11.0",
      });
      expect(
        Buffer.from(
          (await maspStore.get(COMMITMENT, "debug")) ?? [],
        ).toString(),
      ).toBe("debug");
      expect(
        Buffer.from((await maspStore.get(COMMITMENT)) ?? []).toString(),
      ).toBe("release");
    });

    it("still verifies when it failed", async () => {
      expect(
        await verifyBuilt(
          ACCOUNT,
          built({ error: "debug build exports differ" }),
          `0x${"01".repeat(32)}`,
        ),
      ).toBe(true);

      expect(await getPackage(COMMITMENT)).toMatchObject({
        debugCommitment: null,
      });
      expect(await maspStore.get(COMMITMENT, "debug")).toBeNull();
      expect(await maspStore.get(COMMITMENT)).not.toBeNull();
    });

    it("still verifies with an api-compile that doesn't build it", async () => {
      expect(
        await verifyBuilt(ACCOUNT, built(undefined), `0x${"01".repeat(32)}`),
      ).toBe(true);

      expect(await getPackage(COMMITMENT)).toMatchObject({
        debugCommitment: null,
      });
    });

    it("adds it to a package stored without one", async () => {
      await verifyBuilt(
        ACCOUNT,
        built({ error: "debug build too large" }),
        `0x${"01".repeat(32)}`,
      );
      expect(await getPackage(COMMITMENT)).toMatchObject({
        debugCommitment: null,
      });

      expect(
        await verifyBuilt(ACCOUNT, built(debugBuild), `0x${"02".repeat(32)}`),
      ).toBe(true);

      expect(await getPackage(COMMITMENT)).toMatchObject({
        debugCommitment: DEBUG_COMMITMENT,
      });
      expect(await maspStore.get(COMMITMENT, "debug")).not.toBeNull();
    });
  });

  it("requests an account's debug build", async () => {
    const root = `0x${"01".repeat(32)}`;
    const apiCompile = fakeApiCompile({
      verify: vi.fn(async () => ({ ...built(debugBuild), root })),
    });

    expect(await verify(ACCOUNT, apiCompile)).toBe(true);

    expect(apiCompile.verify).toHaveBeenCalledWith({
      project,
      networkId: "mtst",
      resourceId: ACCOUNT.accountId,
      debug: true,
    });
  });

  it("records a note, without a debug build", async () => {
    const root = `0x${"01".repeat(32)}`;
    const apiCompile = fakeApiCompile({
      verify: vi.fn(async () => ({
        ...built(undefined),
        kind: "note" as const,
        root,
      })),
    });

    expect(await verify(NOTE, apiCompile)).toBe(true);

    expect(apiCompile.verify).toHaveBeenCalledWith({
      project,
      networkId: "mtst",
      resourceId: NOTE.noteId,
      debug: false,
    });
    expect(
      await findVerifiedRecordByRoot({ networkId: "mtst", kind: "note", root }),
    ).toMatchObject({
      packageCommitment: COMMITMENT,
      source: "unknown",
      package: { type: "note", debugCommitment: null },
    });
    expect(
      Buffer.from((await maspStore.get(COMMITMENT)) ?? []).toString(),
    ).toBe("release");
  });

  it("records two accounts verified with the same new package at once", async () => {
    // Both read no package before their transactions, so the second insert
    // conflicts on the commitment and finds the first's row.
    expect(
      await Promise.all([
        verifyBuilt(ACCOUNT, built(undefined), `0x${"01".repeat(32)}`),
        verifyBuilt(ACCOUNT, built(undefined), `0x${"02".repeat(32)}`),
      ]),
    ).toEqual([true, true]);

    const dbPackage = await getPackage(COMMITMENT);
    expect(dbPackage).toBeDefined();
    for (const code of [`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`]) {
      const verifiedAccount = await findVerifiedRecordByRoot({
        networkId: "mtst",
        kind: "account",
        root: code,
      });
      expect(verifiedAccount.verifiedAccountComponents).toMatchObject([
        { packageId: dbPackage?.id },
      ]);
    }
  });

  it("records two components verified into one new account at once", async () => {
    // Both read no verified account in their transactions, so the second
    // insert conflicts on (networkId, code) and uses the first's row.
    const root = `0x${"01".repeat(32)}`;
    const other = `0x${"dd".repeat(32)}`;
    expect(
      await Promise.all([
        onOwnConnection(() => verifyBuilt(ACCOUNT, built(undefined), root)),
        onOwnConnection(() =>
          verifyBuilt(
            ACCOUNT,
            { ...built(undefined), commitment: other },
            root,
          ),
        ),
      ]),
    ).toEqual([true, true]);

    expect(
      await db.$count(
        verifiedAccountCodeTable,
        and(
          eq(verifiedAccountCodeTable.networkId, "mtst"),
          eq(verifiedAccountCodeTable.code, root),
        ),
      ),
    ).toBe(1);
    const verifiedAccount = await findVerifiedRecordByRoot({
      networkId: "mtst",
      kind: "account",
      root,
    });
    expect(
      verifiedAccount.verifiedAccountComponents
        .map(({ packageCommitment }) => packageCommitment)
        .sort(),
    ).toEqual([COMMITMENT, other]);
  });

  it("records nothing when the package isn't the resource's", async () => {
    const apiCompile = fakeApiCompile({
      verify: async () => ({
        ...built(undefined),
        verified: false,
        root: `0x${"01".repeat(32)}`,
      }),
    });

    expect(await verify(ACCOUNT, apiCompile)).toBe(false);

    expect(await getPackage(COMMITMENT)).toBeUndefined();
    expect(await maspStore.get(COMMITMENT)).toBeNull();
  });

  it("answers 409 for an account component already verified", async () => {
    const root = `0x${"01".repeat(32)}`;
    await verifyBuilt(ACCOUNT, built(debugBuild), root);

    const error = await verifyBuilt(ACCOUNT, built(debugBuild), root).catch(
      (error) => error,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 409,
      message: "account component already verified",
    });
    const verifiedAccount = await findVerifiedRecordByRoot({
      networkId: "mtst",
      kind: "account",
      root,
    });
    expect(verifiedAccount.verifiedAccountComponents).toHaveLength(1);
  });

  it("answers 409 for an account component verified twice at once", async () => {
    const root = `0x${"01".repeat(32)}`;
    const other = `0x${"dd".repeat(32)}`;
    // The account code already verified with another component, and the
    // package already stored, verified on another network: neither
    // verification inserts the verified account or the package, which would
    // make the second wait on the first's commit and see its component.
    await verifyBuilt(
      ACCOUNT,
      { ...built(undefined), commitment: other },
      root,
    );
    await verifyResource({
      networkId: "mdev",
      resource: ACCOUNT,
      project,
      maspStore,
      apiCompile: fakeApiCompile({
        verify: async () => ({ ...built(undefined), root }),
      }),
    });

    const results = await Promise.allSettled([
      onOwnConnection(() => verifyBuilt(ACCOUNT, built(undefined), root)),
      onOwnConnection(() => verifyBuilt(ACCOUNT, built(undefined), root)),
    ]);

    expect(
      results.filter(({ status }) => status === "fulfilled"),
    ).toMatchObject([{ value: true }]);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      HttpError,
    );
    expect(rejected).toMatchObject({
      reason: { status: 409, message: "account component already verified" },
    });
    const verifiedAccount = await findVerifiedRecordByRoot({
      networkId: "mtst",
      kind: "account",
      root,
    });
    expect(
      verifiedAccount.verifiedAccountComponents
        .map(({ packageCommitment }) => packageCommitment)
        .sort(),
    ).toEqual([COMMITMENT, other]);
  });

  it("answers 409 for a note already verified", async () => {
    const root = `0x${"01".repeat(32)}`;
    await verifyBuilt(NOTE, built(undefined), root);

    const error = await verifyBuilt(NOTE, built(undefined), root).catch(
      (error) => error,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 409,
      message: "note already verified",
    });
  });

  describe("a record the playground verified", () => {
    const root = `0x${"01".repeat(32)}`;
    // What the verification rejected with, to assert on.
    const caught = (promise: Promise<boolean>) =>
      promise.catch((error: unknown) => error);

    it("takes over an account component the playground verified", async () => {
      await verifyBuilt(ACCOUNT, built(undefined), root, "miden-playground");

      expect(
        await verifyBuilt(ACCOUNT, built(undefined), root, "miden-verify"),
      ).toBe(true);

      const { verifiedAccountComponents } = await findVerifiedRecordByRoot({
        networkId: "mtst",
        kind: "account",
        root,
      });
      expect(verifiedAccountComponents).toHaveLength(1);
      expect(verifiedAccountComponents[0]).toMatchObject({
        source: "miden-verify",
      });
    });

    it("takes over a note the playground verified", async () => {
      await verifyBuilt(NOTE, built(undefined), root, "miden-playground");

      expect(
        await verifyBuilt(NOTE, built(undefined), root, "miden-verify"),
      ).toBe(true);

      expect(
        await findVerifiedRecordByRoot({
          networkId: "mtst",
          kind: "note",
          root,
        }),
      ).toMatchObject({ source: "miden-verify" });
    });

    // The source of the root's one record: the account's one component, or
    // the note.
    const recordSource = async (resource: Resource) => {
      if (resource.kind === "account") {
        const { verifiedAccountComponents } = await findVerifiedRecordByRoot({
          networkId: "mtst",
          kind: "account",
          root,
        });
        expect(verifiedAccountComponents).toHaveLength(1);
        return verifiedAccountComponents[0]?.source;
      }
      const note = await findVerifiedRecordByRoot({
        networkId: "mtst",
        kind: "note",
        root,
      });
      return note?.source;
    };

    describe.each([
      ["an account component", ACCOUNT],
      ["a note", NOTE],
    ])("for %s", (_, resource) => {
      it("answers 409 when the playground verifies its own record again", async () => {
        await verifyBuilt(resource, built(undefined), root, "miden-playground");

        const error = await caught(
          verifyBuilt(resource, built(undefined), root, "miden-playground"),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect(error).toMatchObject({ status: 409 });
        expect(await recordSource(resource)).toBe("miden-playground");
      });

      it("answers 409 when the record is another source's", async () => {
        await verifyBuilt(resource, built(undefined), root, "miden-verify");

        const error = await caught(
          verifyBuilt(resource, built(undefined), root, "web-verifier"),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect(error).toMatchObject({ status: 409 });
        expect(await recordSource(resource)).toBe("miden-verify");
      });

      it("leaves a record another source verified alone when the playground comes after", async () => {
        await verifyBuilt(resource, built(undefined), root, "miden-verify");

        const error = await caught(
          verifyBuilt(resource, built(undefined), root, "miden-playground"),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect(error).toMatchObject({ status: 409 });
        expect(await recordSource(resource)).toBe("miden-verify");
      });
    });
  });

  it("answers 409 for a note verified twice at once", async () => {
    const root = `0x${"01".repeat(32)}`;
    // The package already stored, verified on another network: neither
    // verification inserts it, which would make the second wait on the first's
    // commit and see its note.
    await verifyResource({
      networkId: "mdev",
      resource: NOTE,
      project,
      maspStore,
      apiCompile: fakeApiCompile({
        verify: async () => ({ ...built(undefined), root }),
      }),
    });

    const results = await Promise.allSettled([
      onOwnConnection(() => verifyBuilt(NOTE, built(undefined), root)),
      onOwnConnection(() => verifyBuilt(NOTE, built(undefined), root)),
    ]);

    expect(
      results.filter(({ status }) => status === "fulfilled"),
    ).toMatchObject([{ value: true }]);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      HttpError,
    );
    expect(rejected).toMatchObject({
      reason: { status: 409, message: "note already verified" },
    });
    expect(
      await db.$count(
        verifiedNoteScriptTable,
        and(
          eq(verifiedNoteScriptTable.networkId, "mtst"),
          eq(verifiedNoteScriptTable.script, root),
        ),
      ),
    ).toBe(1);
  });

  it("fails with the status of a /verify that may pass on a retry", async () => {
    const failure = new ApiCompileError("rpc error: request timed out", 502);
    const apiCompile = fakeApiCompile({
      verify: () => Promise.reject(failure),
    });

    await expect(verify(ACCOUNT, apiCompile)).rejects.toBe(failure);

    expect(await getPackage(COMMITMENT)).toBeUndefined();
  });

  describe("storage schemas", () => {
    const storage = {
      slots: [
        {
          name: "counter_contract::counter_contract::count_map",
          type: "map" as const,
          keyType: "word",
          valueType: "felt",
        },
      ],
    };

    it("stores the schemas the build read, `{}` for none", async () => {
      await verifyBuilt(ACCOUNT, built(), `0x${"41".repeat(32)}`);
      expect(await getPackage(COMMITMENT)).toHaveProperty("schemas", {});
    });

    it("fills them in on a package stored before it kept them", async () => {
      await verifyBuilt(ACCOUNT, built(), `0x${"42".repeat(32)}`);
      const stored = await getPackage(COMMITMENT);
      // As an older registry stored it.
      await updatePackage(stored?.id ?? "", { schemas: null });

      await verifyBuilt(
        ACCOUNT,
        { ...built(), storage },
        `0x${"43".repeat(32)}`,
      );

      expect(await getPackage(COMMITMENT)).toHaveProperty("schemas", {
        storage,
      });
    });
  });
});
