import type {
  Package,
  VerifiedAccountById,
  VerifiedAccountComponent,
  VerifiedNoteById,
} from "miden-source-code-verification-utils/api-registry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_REGISTRY_TIMEOUT_MS } from "@/lib/constants.server";
import { loadResourcePage } from "@/lib/resource-page.server";

const ACCOUNT_ID = "0x7db388f2c58f4251104a1aa6a7c2d4";
const NOTE_ID =
  "0xb080e8318dfdf8230bda5d8acd67119621aacfe89eab1d08deb3114cc87ac606";
const UNAVAILABLE =
  "The verification status could not be checked right now. Please try again in a minute.";

const digest = (n: number) =>
  `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const at = "2026-11-06T20:33:09.307Z";

// A package exporting `digests` as account procedures (abi 3), with the crate
// its entry file is found by.
const pkg = (name: string, ...digests: `0x${string}`[]): Package => {
  // Paths as the compiler spells them: the crate's WIT world, then the
  // kebab-cased, quoted procedure name.
  const paths = digests.map(
    (_, i) => `::"miden:${name}/${name}@0.1.0"::"proc-${i}"`,
  );
  return {
    id: `${name}-id`,
    name,
    type: "account-component",
    files: {
      "Cargo.toml": `[package]\nname = "${name}"\n`,
      "src/lib.rs": "pub fn proc_0() {}\n",
      "Cargo.lock": "",
    },
    commitment: digest(0xc0),
    manifest: {
      exports: digests.map((d, i) => ({
        Procedure: {
          path: paths[i],
          node: null,
          source_node: null,
          digest: d,
          signature: { abi: 3, params: [], results: [] },
          attributes: { attrs: [] },
        },
      })),
      dependencies: [],
    },
    entrypoint: ".",
    builtWith: null,
    debugCommitment: null,
    debugBuiltWith: null,
    readOnly: Object.fromEntries(paths.map((path) => [path, true])),
    schemas: {},
    createdAt: at,
    updatedAt: at,
  };
};

const component = (
  verifiedPackage: Package,
  source: string,
): VerifiedAccountComponent => ({
  id: `${verifiedPackage.id}-component`,
  verifiedAccountId: "account-record",
  packageId: verifiedPackage.id,
  packageCommitment: verifiedPackage.commitment,
  source,
  createdAt: at,
  updatedAt: at,
  package: verifiedPackage,
  debugPackage: null,
});

// Four procedures: two from the wallet, one from `counter-contract`, one
// nothing accounts for; `other` exports a digest outside the account's code.
const account: VerifiedAccountById = {
  id: "account-record",
  networkId: "mtst",
  code: digest(0xa0),
  createdAt: at,
  updatedAt: at,
  verifiedAccountComponents: [
    component(pkg("counter-contract", digest(3)), "miden-verify"),
    component(pkg("other", digest(9)), "web-verifier"),
  ],
  accountId: ACCOUNT_ID,
  standardAccountComponents: [
    { name: "BasicWallet", procedures: [digest(1), digest(2)] },
  ],
  procedures: [digest(1), digest(2), digest(3), digest(4)],
};

const note: VerifiedNoteById = {
  id: "note-record",
  networkId: "mtst",
  script: digest(0x5),
  source: "web-verifier",
  packageId: "counter-note-id",
  packageCommitment: digest(0xc0),
  createdAt: at,
  updatedAt: at,
  package: pkg("counter-note", digest(5)),
  noteId: NOTE_ID,
};

// The registry, answering every request with `response`.
const registry = (response: () => Response) => {
  const fetch = vi.fn((_url: string) => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadResourcePage", () => {
  it("throws a 404 for a network the registry doesn't serve, before any lookup", async () => {
    const fetch = registry(() => json(account));
    await expect(
      loadResourcePage({
        networkId: "mxx",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws a 404 when the registry has no record for the resource", async () => {
    registry(() => json({ error: "verified note not found" }, 404));
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "note", noteId: NOTE_ID },
      }),
    ).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("reports a registry that couldn't look the resource up as temporary", async () => {
    registry(() => json({ error: "api-compile is busy" }, 503));
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      init: { status: 503, statusText: UNAVAILABLE },
    });
  });

  it("reports a registry it can't reach as temporary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      init: { status: 502, statusText: UNAVAILABLE },
    });
  });

  it("gives up on a registry that doesn't answer", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // Fake timers don't drive AbortSignal.timeout: shorten it instead.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(10));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
          new Promise<globalThis.Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    );
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      init: { status: 504, statusText: UNAVAILABLE },
    });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(API_REGISTRY_TIMEOUT_MS);
  });

  it("gives up on a registry that stops sending its answer", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // Fake timers don't drive AbortSignal.timeout: shorten it instead.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(10));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  init?.signal?.addEventListener("abort", () =>
                    controller.error(init.signal?.reason),
                  );
                },
              }),
              { status: 200 },
            ),
          ),
      ),
    );
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      init: { status: 504, statusText: UNAVAILABLE },
    });
  });

  it("reports an answer that isn't JSON as temporary", async () => {
    registry(() => new Response("<html>bad gateway</html>", { status: 200 }));
    await expect(
      loadResourcePage({
        networkId: "mtst",
        resource: { kind: "account", accountId: ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      init: { status: 502, statusText: UNAVAILABLE },
    });
  });

  it("loads an account's page: a package per component, the status their manifests give", async () => {
    const fetch = registry(() => json(account));
    const page = await loadResourcePage({
      networkId: "mtst",
      resource: { kind: "account", accountId: ACCOUNT_ID },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(`/v1/mtst/verified-accounts/${ACCOUNT_ID}$`),
      { signal: expect.any(AbortSignal) },
    );
    expect(page.networkName).toBe("Testnet");
    expect(page.verificationStatus).toEqual({ verified: 3, total: 4 });
    expect(page.standardAccountComponents).toEqual(["BasicWallet"]);
    expect(page.packages.map(({ name, source }) => ({ name, source }))).toEqual(
      [
        { name: "counter-contract", source: "miden-verify" },
        { name: "other", source: "web-verifier" },
      ],
    );
    const [counter] = page.packages;
    // The displayed sources, highlighted, without the lockfile; every file raw.
    expect(counter.files.map(({ path }) => path)).toEqual([
      "Cargo.toml",
      "src/lib.rs",
    ]);
    expect(counter.files[1].html).toContain("proc_0");
    expect(counter.entryPath).toBe("src/lib.rs");
    expect(Object.keys(counter.rawFiles)).toContain("Cargo.lock");
    expect(counter.procedures).toEqual([
      {
        name: "proc_0",
        signature: "fn proc_0();",
        digest: digest(3),
        readOnly: true,
      },
    ]);
  });

  it("loads a note's page: its one package, fully verified", async () => {
    const fetch = registry(() => json(note));
    const page = await loadResourcePage({
      networkId: "mtst",
      resource: { kind: "note", noteId: NOTE_ID },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(`/v1/mtst/verified-notes/${NOTE_ID}$`),
      { signal: expect.any(AbortSignal) },
    );
    expect(page.networkName).toBe("Testnet");
    expect(page.verificationStatus).toEqual({ verified: 1, total: 1 });
    expect(page.standardAccountComponents).toEqual([]);
    expect(page.packages.map(({ name, source }) => ({ name, source }))).toEqual(
      [{ name: "counter-note", source: "web-verifier" }],
    );
  });
});
