import type { Word } from "miden-source-code-verification-utils/manifest";
import { describe, expect, it } from "vitest";

import type { PackageManifest } from "@/lib/api-registry.server";
import { getVerificationStatus } from "@/lib/verification-status";

const digest = (n: number): Word => `0x${n.toString(16).padStart(64, "0")}`;

// A package exporting `digests` as account procedures (abi 3).
const manifest = (...digests: Word[]): PackageManifest => ({
  exports: digests.map((d, i) => ({
    Procedure: {
      path: `::component::procedure${i}`,
      digest: d,
      signature: { abi: 3 },
    },
  })),
  dependencies: [],
});

const wallet = { name: "BasicWallet", procedures: [digest(1), digest(2)] };

describe("getVerificationStatus", () => {
  it("is fully verified when every procedure is accounted for", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(1), digest(2), digest(3), digest(4)],
        standardAccountComponents: [wallet],
        manifests: [manifest(digest(3)), manifest(digest(4))],
      }),
    ).toEqual({ verified: 4, total: 4 });
  });

  it("is partially verified when a component is missing", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(1), digest(2), digest(3), digest(4)],
        standardAccountComponents: [wallet],
        manifests: [manifest(digest(3))],
      }),
    ).toEqual({ verified: 3, total: 4 });
  });

  it("counts a procedure claimed twice only once", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(1), digest(2), digest(3)],
        standardAccountComponents: [wallet],
        manifests: [manifest(digest(2)), manifest(digest(2))],
      }),
    ).toEqual({ verified: 2, total: 3 });
  });

  it("ignores exports that aren't account procedures", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(1), digest(2)],
        standardAccountComponents: [],
        manifests: [
          {
            exports: [
              {
                Procedure: {
                  path: "::component::procedure0",
                  digest: digest(1),
                  signature: { abi: 3 },
                },
              },
              {
                Procedure: {
                  path: "::component::procedure1",
                  digest: digest(2),
                  signature: { abi: 0 },
                },
              },
              {
                Procedure: {
                  path: "::component::procedure2",
                  digest: digest(2),
                  signature: null,
                },
              },
              {},
            ],
            dependencies: [],
          },
        ],
      }),
    ).toEqual({ verified: 1, total: 2 });
  });

  it("ignores digests outside the account's code", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(1)],
        standardAccountComponents: [],
        manifests: [manifest(digest(1), digest(9))],
      }),
    ).toEqual({ verified: 1, total: 1 });
  });

  it("matches digests case-insensitively", () => {
    expect(
      getVerificationStatus({
        procedures: [digest(0xab)],
        standardAccountComponents: [],
        manifests: [manifest(`0x${digest(0xab).slice(2).toUpperCase()}`)],
      }),
    ).toEqual({ verified: 1, total: 1 });
  });
});
