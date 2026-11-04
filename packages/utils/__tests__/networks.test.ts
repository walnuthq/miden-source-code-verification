import { describe, expect, it } from "vitest";

import {
  DEFAULT_NETWORK,
  getNetworkName,
  isNetworkId,
  parseNetwork,
} from "../src/networks.ts";

describe("networks", () => {
  it("serves Testnet, Devnet and Mainnet", () => {
    for (const networkId of ["mtst", "mdev", "mm"]) {
      expect(isNetworkId(networkId)).toBe(true);
    }
    expect(getNetworkName("mm")).toBe("Mainnet");
  });

  it("rejects networks it doesn't serve", () => {
    expect(isNetworkId("mlcl")).toBe(false);
    expect(isNetworkId("mxx")).toBe(false);
    expect(getNetworkName("mxx")).toBeUndefined();
  });

  it("parses ?network=, falling back to Testnet", () => {
    expect(DEFAULT_NETWORK).toBe("mtst");
    expect(parseNetwork("mm")).toBe("mm");
    expect(parseNetwork("mxx")).toBe("mtst");
    expect(parseNetwork(null)).toBe("mtst");
  });
});
