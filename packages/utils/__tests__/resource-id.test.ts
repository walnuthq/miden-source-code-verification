import { bech32, bech32m, hex } from "@scure/base";
import { describe, expect, it } from "vitest";

import {
  decodeAddress,
  detectNetwork,
  parseResourceId,
  RESOURCE_ID_PATTERN,
} from "../src/resource-id.js";

// Example from miden-protocol's `AccountId::to_bech32` docs.
const PROTOCOL_ACCOUNT_ID = "0x6d449e4034fadca075d1976fef7e38";
const PROTOCOL_ADDRESS = "mm1apk5f8jqxnadegr46xtklmm78qhdgkwc";

const ACCOUNT_ID = "0xdef0e93b672a39117a3af1520c6047";
const NOTE_ID = `0x${"ab".repeat(32)}`;

const accountIdBytes = (accountId: string) => hex.decode(accountId.slice(2));
const encodeAddress = (networkId: string, bytes: Uint8Array) =>
  bech32m.encodeFromBytes(networkId, bytes);
const accountAddress = (networkId: string, accountId: string) =>
  encodeAddress(
    networkId,
    Uint8Array.from([232, ...accountIdBytes(accountId)]),
  );

describe("decodeAddress", () => {
  it("decodes miden-protocol's example address", () => {
    expect(decodeAddress(PROTOCOL_ADDRESS)).toEqual({
      networkId: "mm",
      accountId: PROTOCOL_ACCOUNT_ID,
    });
  });

  it("ignores routing parameters and surrounding whitespace", () => {
    expect(decodeAddress(`  ${PROTOCOL_ADDRESS}_qruqqypuyph `)).toEqual({
      networkId: "mm",
      accountId: PROTOCOL_ACCOUNT_ID,
    });
  });

  it("rejects a bad checksum", () => {
    const corrupted = `${PROTOCOL_ADDRESS.slice(0, -1)}q`;
    expect(decodeAddress(corrupted)).toBeNull();
  });

  it("rejects bech32 (only bech32m is valid)", () => {
    const bytes = Uint8Array.from([232, ...accountIdBytes(ACCOUNT_ID)]);
    expect(decodeAddress(bech32.encodeFromBytes("mtst", bytes))).toBeNull();
  });

  it("rejects other address types and lengths", () => {
    const id = accountIdBytes(ACCOUNT_ID);
    expect(
      decodeAddress(encodeAddress("mtst", Uint8Array.from([0, ...id]))),
    ).toBeNull();
    expect(
      decodeAddress(
        encodeAddress("mtst", Uint8Array.from([232, ...id.slice(1)])),
      ),
    ).toBeNull();
  });

  it("rejects hex IDs and empty input", () => {
    expect(decodeAddress(ACCOUNT_ID)).toBeNull();
    expect(decodeAddress(NOTE_ID)).toBeNull();
    expect(decodeAddress("")).toBeNull();
  });
});

describe("detectNetwork", () => {
  it("returns the network of an address on a served network", () => {
    expect(detectNetwork(accountAddress("mtst", ACCOUNT_ID))).toBe("mtst");
    expect(detectNetwork(accountAddress("mdev", ACCOUNT_ID))).toBe("mdev");
  });

  it("returns null for other networks and non-addresses", () => {
    expect(detectNetwork(PROTOCOL_ADDRESS)).toBeNull();
    expect(detectNetwork(ACCOUNT_ID)).toBeNull();
    expect(detectNetwork("mtst1")).toBeNull();
  });
});

describe("parseResourceId", () => {
  it("parses note IDs", () => {
    expect(parseResourceId(NOTE_ID)).toEqual({ kind: "note", noteId: NOTE_ID });
  });

  it("parses hex account IDs", () => {
    expect(parseResourceId(` ${ACCOUNT_ID} `)).toEqual({
      kind: "account",
      accountId: ACCOUNT_ID,
    });
  });

  it("resolves addresses to their hex account ID", () => {
    expect(
      parseResourceId(`${accountAddress("mtst", ACCOUNT_ID)}_qruqqypuyph`),
    ).toEqual({ kind: "account", accountId: ACCOUNT_ID });
  });

  it("returns null for empty or malformed input", () => {
    expect(parseResourceId("")).toBeNull();
    expect(parseResourceId("garbage")).toBeNull();
    expect(parseResourceId(ACCOUNT_ID.slice(0, -1))).toBeNull();
  });
});

describe("RESOURCE_ID_PATTERN", () => {
  // How browsers compile an input's `pattern` attribute.
  const pattern = new RegExp(`^(?:${RESOURCE_ID_PATTERN})$`, "v");

  it("matches every kind of Resource ID", () => {
    const address = accountAddress("mtst", ACCOUNT_ID);
    for (const value of [
      ACCOUNT_ID,
      NOTE_ID,
      address,
      `${address}_qruqqypuyph`,
    ]) {
      expect(pattern.test(value)).toBe(true);
    }
  });

  it("rejects malformed input", () => {
    for (const value of ["garbage", ACCOUNT_ID.slice(0, -1), "mtst1", "0x"]) {
      expect(pattern.test(value)).toBe(false);
    }
  });
});
