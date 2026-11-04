import { describe, expect, it } from "vitest";

import { getExplorerUrl } from "@/lib/constants";

describe("getExplorerUrl", () => {
  it("links to each served network's explorer", () => {
    expect(getExplorerUrl("mtst", "account", "mtst1abc")).toBe(
      "https://testnet.midenscan.com/account/mtst1abc",
    );
    expect(getExplorerUrl("mdev", "note", "0x01")).toBe(
      "https://devnet.midenscan.com/note/0x01",
    );
    expect(getExplorerUrl("mm", "account", "mm1abc")).toBe(
      "https://explorer.mainnet.miden.io/account/mm1abc",
    );
  });

  it("has no link for a network without an explorer", () => {
    expect(getExplorerUrl("mlcl", "account", "mlcl1abc")).toBeUndefined();
  });
});
