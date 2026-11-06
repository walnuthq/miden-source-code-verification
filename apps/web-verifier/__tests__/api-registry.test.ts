import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BUSY_RETRIES,
  resourceCollection,
  verifyResource,
} from "@/lib/api-registry";

const ACCOUNT = {
  kind: "account",
  accountId: "0x7db388f2c58f4251104a1aa6a7c2d4",
} as const;
const NOTE = {
  kind: "note",
  noteId: "0xb080e8318dfdf8230bda5d8acd67119621aacfe89eab1d08deb3114cc87ac606",
} as const;
const files = { "Cargo.toml": '[package]\nname = "counter-contract"\n' };
const BUSY = "The verifier is busy. Please try again in a few minutes.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const busy = (retryAfter?: string) =>
  new Response(null, {
    status: 503,
    headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
  });

// The registry, answering each request with the next response.
const registry = (...responses: Response[]) => {
  const fetch = vi.fn(
    async () => responses.shift() ?? json({ error: "unexpected request" }, 500),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

// A submission from the form, with `wait` recording the seconds it would have
// counted down.
const submit = (resource: typeof ACCOUNT | typeof NOTE) => {
  const waits: number[] = [];
  const outcome = verifyResource({
    registryUrl: "http://registry.test",
    network: "mtst",
    resource,
    files,
    entrypoint: ".",
    source: "web-verifier",
    wait: async (seconds) => {
      waits.push(seconds);
    },
  });
  return { outcome, waits };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyResource", () => {
  it("posts the project to the account collection, the account id first", async () => {
    const fetch = registry(json({ verified: true }));
    await expect(submit(ACCOUNT).outcome).resolves.toEqual({ verified: true });
    expect(fetch).toHaveBeenCalledWith(
      "http://registry.test/v1/mtst/verified-accounts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: ACCOUNT.accountId,
          files,
          entrypoint: ".",
          source: "web-verifier",
        }),
      },
    );
  });

  it("posts a note to the note collection, by noteId", async () => {
    const fetch = registry(json({ verified: false }));
    await expect(submit(NOTE).outcome).resolves.toEqual({ verified: false });
    expect(fetch).toHaveBeenCalledWith(
      "http://registry.test/v1/mtst/verified-notes",
      expect.objectContaining({
        body: JSON.stringify({
          noteId: NOTE.noteId,
          files,
          entrypoint: ".",
          source: "web-verifier",
        }),
      }),
    );
  });

  it("waits a busy verifier's Retry-After and resubmits", async () => {
    const fetch = registry(busy("2"), busy(), json({ verified: true }));
    const { outcome, waits } = submit(ACCOUNT);
    await expect(outcome).resolves.toEqual({ verified: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2, 30]);
  });

  it("gives up with the busy message once the retries are spent", async () => {
    const fetch = registry(
      ...Array.from({ length: MAX_BUSY_RETRIES + 1 }, () => busy("1")),
    );
    const { outcome, waits } = submit(ACCOUNT);
    await expect(outcome).resolves.toEqual({ error: BUSY });
    expect(fetch).toHaveBeenCalledTimes(MAX_BUSY_RETRIES + 1);
    expect(waits).toEqual([1, 1, 1]);
  });

  it("words an outage for the user, whatever the registry said", async () => {
    registry(json({ error: "api-compile is unreachable" }, 502));
    await expect(submit(ACCOUNT).outcome).resolves.toEqual({
      error:
        "The verifier could not reach the compiler. Please try again later.",
    });
    registry(new Response("upstream request timeout", { status: 504 }));
    await expect(submit(NOTE).outcome).resolves.toEqual({
      error: "The verifier took too long to answer. Please try again later.",
    });
  });

  it("passes the registry's reason through for a refused project", async () => {
    registry(json({ error: "missing Cargo.toml" }, 400));
    await expect(submit(ACCOUNT).outcome).resolves.toEqual({
      error: "missing Cargo.toml",
    });
  });

  it("names a failure with no reason by its status", async () => {
    registry(new Response("<html>Bad gateway</html>", { status: 500 }));
    await expect(submit(ACCOUNT).outcome).resolves.toEqual({
      error: "Request failed (500)",
    });
  });
});

describe("resourceCollection", () => {
  it("is the registry's collection for each kind", () => {
    expect(resourceCollection("account")).toBe("verified-accounts");
    expect(resourceCollection("note")).toBe("verified-notes");
  });
});
