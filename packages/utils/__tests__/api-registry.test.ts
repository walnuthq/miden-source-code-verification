import { describe, expect, it } from "vitest";

import {
  maspDownloadName,
  maspKey,
  packageMaspPath,
  parseMaspKey,
} from "../src/api-registry.ts";

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

describe("maspDownloadName", () => {
  it("spells the package name as Rust spells the crate", () => {
    expect(maspDownloadName("counter-contract", COMMITMENT)).toBe(
      "counter_contract.masp",
    );
    expect(maspDownloadName("counter", COMMITMENT)).toBe("counter.masp");
  });

  it("names the debug build with .debug", () => {
    expect(maspDownloadName("counter-contract", COMMITMENT, "debug")).toBe(
      "counter_contract.debug.masp",
    );
  });

  it("collapses runs of other characters and drops leading underscores", () => {
    expect(
      maspDownloadName("miden:basic-wallet/basic-wallet", COMMITMENT),
    ).toBe("miden_basic_wallet_basic_wallet.masp");
    expect(maspDownloadName("--my  pkg!v1.2", COMMITMENT)).toBe(
      "my_pkg_v1.2.masp",
    );
  });

  it("is the artifact's key when nothing is left of the name", () => {
    expect(maspDownloadName("", COMMITMENT)).toBe(`${COMMITMENT}.masp`);
    expect(maspDownloadName("-:/", COMMITMENT, "debug")).toBe(
      `${COMMITMENT}.debug.masp`,
    );
  });
});

describe("packageMaspPath", () => {
  it("is the registry's route to the artifact, by key", () => {
    expect(packageMaspPath("mtst", COMMITMENT)).toBe(
      `/v1/mtst/packages/masp/${COMMITMENT}.masp`,
    );
    expect(packageMaspPath("mtst", COMMITMENT, "debug")).toBe(
      `/v1/mtst/packages/masp/${COMMITMENT}.debug.masp`,
    );
  });
});
