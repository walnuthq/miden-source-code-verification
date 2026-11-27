import { describe, expect, it, vi } from "vitest";

import {
  fetchWhileBusy,
  maspDownloadName,
  maspKey,
  packageMaspPath,
  parseMaspKey,
  retryAfterSeconds,
} from "../src/api-registry.ts";

const COMMITMENT = "0xd4ae21452bf89eec3d7156eb9ae870f07c792bf8526329631492ff7ee9862b9d";

describe("maspKey / parseMaspKey", () => {
  it("round-trips", () => {
    expect(maspKey(COMMITMENT)).toBe(`${COMMITMENT}.masp`);
    expect(parseMaspKey(maspKey(COMMITMENT))).toBe(COMMITMENT);
  });

  it("matches case-insensitively and lowercases the commitment", () => {
    const upper = `0x${COMMITMENT.slice(2).toUpperCase()}`;
    expect(maspKey(upper)).toBe(`${COMMITMENT}.masp`);
    expect(parseMaspKey(`${upper}.MASP`)).toBe(COMMITMENT);
  });

  it("rejects anything else, a debug build's name included", () => {
    for (const key of [
      "counter-contract.masp",
      COMMITMENT,
      `${COMMITMENT}.debug.masp`,
      `${COMMITMENT}.release.masp`,
      `${COMMITMENT.slice(0, -2)}.masp`,
    ]) {
      expect(parseMaspKey(key)).toBeNull();
    }
  });
});

describe("maspDownloadName", () => {
  it("spells the package name with underscores", () => {
    expect(maspDownloadName("counter-contract", COMMITMENT)).toBe("counter_contract.masp");
    expect(maspDownloadName("counter", COMMITMENT)).toBe("counter.masp");
  });

  it("collapses runs of other characters and drops leading underscores", () => {
    expect(maspDownloadName("miden:basic-wallet/basic-wallet", COMMITMENT)).toBe(
      "miden_basic_wallet_basic_wallet.masp",
    );
    expect(maspDownloadName("--my  pkg!v1.2", COMMITMENT)).toBe("my_pkg_v1.2.masp");
  });

  it("is the artifact's key when nothing is left of the name", () => {
    expect(maspDownloadName("", COMMITMENT)).toBe(`${COMMITMENT}.masp`);
    expect(maspDownloadName("-:/", COMMITMENT)).toBe(`${COMMITMENT}.masp`);
  });
});

describe("packageMaspPath", () => {
  it("is the registry's route to the artifact, by key", () => {
    expect(packageMaspPath("mtst", COMMITMENT)).toBe(`/v1/mtst/packages/masp/${COMMITMENT}.masp`);
  });
});

describe("retryAfterSeconds", () => {
  it("reads the header in whole seconds, up to two minutes", () => {
    expect(retryAfterSeconds("30")).toBe(30);
    expect(retryAfterSeconds("2.5")).toBe(3);
    expect(retryAfterSeconds("1000")).toBe(120);
  });

  it("waits half a minute for a missing or odd header", () => {
    for (const header of [null, "", "soon", "0", "-5", "0.4"]) {
      expect(retryAfterSeconds(header)).toBe(30);
    }
  });
});

describe("fetchWhileBusy", () => {
  const busy = (retryAfter?: string) =>
    new Response(null, {
      status: 503,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
  const ok = () => new Response("{}", { status: 200 });

  // A server answering each request with the next response, then 200s.
  const server = (...responses: Response[]) => {
    const waits: number[] = [];
    const request = vi.fn(async () => responses.shift() ?? ok());
    const wait = async (seconds: number) => {
      waits.push(seconds);
    };
    return { request, wait, waits };
  };

  it("resends after each 503's Retry-After and answers the first other response", async () => {
    const { request, wait, waits } = server(busy("5"), busy(), ok());
    const response = await fetchWhileBusy(request, { maxRetries: 3, wait });
    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([5, 30]);
  });

  it("answers the last 503 once the retries are spent", async () => {
    const { request, wait, waits } = server(busy("1"), busy("1"), busy("1"));
    const response = await fetchWhileBusy(request, { maxRetries: 2, wait });
    expect(response.status).toBe(503);
    expect(request).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1, 1]);
  });

  it("retries nothing but a 503", async () => {
    const { request, wait, waits } = server(new Response(null, { status: 502 }));
    const response = await fetchWhileBusy(request, { maxRetries: 3, wait });
    expect(response.status).toBe(502);
    expect(request).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
