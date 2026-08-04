import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import {
  accounts,
  COUNTER_CONTRACT_ID_1,
  COUNTER_NOTE_ID_1,
  notes,
  readProjectFiles,
} from "miden-source-code-verification-test-utils";

import type {
  CheckSummary,
  EndpointStatus,
  ServiceHealth,
  ServiceStatus,
  StatusSnapshot,
} from "../src/lib/types.js";

// Build-time probe. Runs on the CI runner (see .github/workflows/deploy-pages.yml)
// rather than in the browser, because api-registry's CORS allowlist has no
// github.io entry and web-verifier serves no CORS headers at all — the checks
// simply would not be permitted client-side.
//
// The output is written to public/, so Vite copies it into dist/ verbatim and the
// page fetches it at runtime. Keeping it out of the module graph means a fresh
// checkout can `pnpm typecheck` and `pnpm build` without the file existing yet.
//
// Fixtures come from the same package the api-compile test suite uses, so the
// two never drift — nothing about the dataset is duplicated here.

const API_COMPILE_URL = process.env.API_COMPILE_URL ?? "http://localhost:8080";
const API_REGISTRY_URL =
  process.env.API_REGISTRY_URL ?? "http://localhost:8081";
const WEB_VERIFIER_URL =
  process.env.WEB_VERIFIER_URL ?? "http://localhost:5173";

// A plain reachability check. api-compile's `/` proxies into a Cloudflare
// Container that may be asleep, and a cold start costs several seconds.
const DEFAULT_TIMEOUT_MS = 15_000;
// The compile endpoints do real work (cargo-miden build) and may additionally
// pay a container cold start, so they get a much longer leash.
const COMPILE_TIMEOUT_MS = 120_000;

const findRepoRoot = (start: string): string => {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the monorepo root from ${start}`);
    }
    dir = parent;
  }
};

// The project the compile/verify checks submit. Same sources the
// `it compiles a counter-contract` test uses — read from disk rather than
// inlined so the two stay in step.
const counterContractDir = path.join(
  findRepoRoot(import.meta.dirname),
  "apps/api-compile/examples/counter-contract/counter-contract",
);

// Read once and reused by both POST checks.
let counterContractFiles: Record<string, string> | undefined;
const loadCounterContract = async () => {
  counterContractFiles ??= await readProjectFiles(counterContractDir);
  return counterContractFiles;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const truncateHex = (value: unknown) =>
  typeof value === "string" && value.length > 20
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : String(value ?? "—");

type EndpointCheck = {
  id: string;
  /** Human-readable request line shown on the card. */
  label: string;
  method: "GET" | "POST";
  /** Appended to the service URL. */
  path: string;
  timeoutMs?: number;
  /** Built lazily so a body that needs disk I/O only runs when the check does. */
  body?: () => Promise<unknown>;
  /**
   * Whether the response body is rendered verbatim. Only safe for small
   * payloads — `/compile` alone returns ~80 KB.
   */
  showPayload?: boolean;
  /** Lifts the few interesting fields out of a large response. */
  summarize?: (payload: unknown) => CheckSummary;
  /** Returns an error message when the response is wrong, else null. */
  assert?: (payload: unknown) => string | null;
};

type ServiceDefinition = {
  id: string;
  name: string;
  description: string;
  url: string;
  endpoints: EndpointCheck[];
};

const rootCheck: EndpointCheck = {
  id: "root",
  label: "GET /",
  method: "GET",
  path: "/",
  showPayload: true,
};

const NETWORK_ID = "mtst";
// The roots the registry keys its records on, alongside the network: an
// account's code root and a note's script root. Both come from the shared
// fixtures.
const ACCOUNT_CODE = accounts[COUNTER_CONTRACT_ID_1]?.code ?? "";
const NOTE_SCRIPT = notes[COUNTER_NOTE_ID_1]?.code ?? "";

// A registry record carries its source package, which bundles every source file
// plus the compiled masp — 168 KB for the account, 49 KB for the note — so these
// checks summarize rather than render the body.

/**
 * Both verified-account routes return the same record; the by-id one resolves
 * the code root on-chain first and echoes back the account it resolved from.
 * Asserting the root and network come back unchanged is what proves the
 * registry returned the record we asked for rather than merely returning
 * something.
 */
const verifiedAccountCheck = ({ byId }: { byId: boolean }): EndpointCheck => {
  const path = byId
    ? `/v1/${NETWORK_ID}/verified-accounts/${COUNTER_CONTRACT_ID_1}`
    : `/v1/${NETWORK_ID}/verified-accounts/code/${ACCOUNT_CODE}`;
  return {
    id: byId ? "verified-account-by-id" : "verified-account-by-code",
    // Roots are 66 chars and would be truncated away in the card, so the label
    // shortens them while `path` keeps the value the request actually uses.
    label: byId
      ? `GET ${path}`
      : `GET /v1/${NETWORK_ID}/verified-accounts/code/${truncateHex(ACCOUNT_CODE)}`,
    method: "GET",
    path,
    summarize: (payload) => {
      const body = asRecord(payload);
      const components = Array.isArray(body.verifiedAccountComponents)
        ? body.verifiedAccountComponents
        : [];
      const pkg = asRecord(asRecord(components[0]).package);
      return {
        ...(byId ? { accountId: String(body.accountId ?? "—") } : {}),
        networkId: String(body.networkId ?? "—"),
        code: truncateHex(body.code),
        components: components.length,
        package: String(pkg.name ?? "—"),
        type: String(pkg.type ?? "—"),
        "source files": Object.keys(asRecord(pkg.files)).length,
        source: String(body.source ?? "—"),
      };
    },
    assert: (payload) => {
      const body = asRecord(payload);
      if (body.code !== ACCOUNT_CODE) {
        return "returned a record for a different code root";
      }
      if (body.networkId !== NETWORK_ID) {
        return "returned a record for a different network";
      }
      const components = Array.isArray(body.verifiedAccountComponents)
        ? body.verifiedAccountComponents
        : [];
      if (components.length === 0) return "record has no verified components";
      if (byId && body.accountId !== COUNTER_CONTRACT_ID_1) {
        return "echoed a different accountId";
      }
      return null;
    },
  };
};

/**
 * The note equivalent — keyed on the network and script root, with the package
 * inline.
 */
const verifiedNoteCheck = ({ byId }: { byId: boolean }): EndpointCheck => {
  const path = byId
    ? `/v1/${NETWORK_ID}/verified-notes/${COUNTER_NOTE_ID_1}`
    : `/v1/${NETWORK_ID}/verified-notes/script/${NOTE_SCRIPT}`;
  return {
    id: byId ? "verified-note-by-id" : "verified-note-by-script",
    label: byId
      ? `GET /v1/${NETWORK_ID}/verified-notes/${truncateHex(COUNTER_NOTE_ID_1)}`
      : `GET /v1/${NETWORK_ID}/verified-notes/script/${truncateHex(NOTE_SCRIPT)}`,
    method: "GET",
    path,
    summarize: (payload) => {
      const body = asRecord(payload);
      const pkg = asRecord(body.package);
      return {
        ...(byId ? { noteId: truncateHex(body.noteId) } : {}),
        networkId: String(body.networkId ?? "—"),
        script: truncateHex(body.script),
        package: String(pkg.name ?? "—"),
        type: String(pkg.type ?? "—"),
        "source files": Object.keys(asRecord(pkg.files)).length,
        source: String(body.source ?? "—"),
      };
    },
    assert: (payload) => {
      const body = asRecord(payload);
      if (body.script !== NOTE_SCRIPT) {
        return "returned a record for a different script root";
      }
      if (body.networkId !== NETWORK_ID) {
        return "returned a record for a different network";
      }
      if (asRecord(body.package).type !== "note") {
        return "record's package is not a note";
      }
      if (byId && body.noteId !== COUNTER_NOTE_ID_1) {
        return "echoed a different noteId";
      }
      return null;
    },
  };
};

const apiCompile: ServiceDefinition = {
  id: "api-compile",
  name: "api-compile",
  description:
    "Compiles Rust sources to Miden packages and verifies them against on-chain code.",
  url: API_COMPILE_URL,
  endpoints: [
    rootCheck,
    {
      id: "compile",
      label: "POST /compile",
      method: "POST",
      path: "/compile",
      timeoutMs: COMPILE_TIMEOUT_MS,
      body: async () => ({ files: await loadCounterContract() }),
      summarize: (payload) => {
        const body = asRecord(payload);
        const manifest = asRecord(body.manifest);
        return {
          digest: truncateHex(body.digest),
          exports: Array.isArray(manifest.exports)
            ? manifest.exports.length
            : 0,
          dependencies: Array.isArray(manifest.dependencies)
            ? manifest.dependencies.length
            : 0,
          "masp chars": typeof body.masp === "string" ? body.masp.length : 0,
          "stderr chars":
            typeof body.stderr === "string" ? body.stderr.length : 0,
        };
      },
      assert: (payload) => {
        const body = asRecord(payload);
        if (typeof body.masp !== "string" || body.masp.length === 0) {
          // A compile failure still returns 200 with stdout/stderr and no
          // masp, so the status code alone would not catch it.
          return "compiled without producing a package";
        }
        if (typeof body.digest !== "string") return "missing digest";
        if (!body.manifest) return "missing manifest";
        return null;
      },
    },
    {
      id: "verify",
      label: "POST /verify",
      method: "POST",
      path: "/verify",
      timeoutMs: COMPILE_TIMEOUT_MS,
      // No `resource` field, so the endpoint fetches the account from the
      // network — this exercises the full on-chain path, mirroring the
      // `it verifies an on-chain counter-contract` test.
      body: async () => ({
        files: await loadCounterContract(),
        networkId: "mtst",
        resourceId: COUNTER_CONTRACT_ID_1,
      }),
      summarize: (payload) => {
        const body = asRecord(payload);
        const manifest = asRecord(body.manifest);
        return {
          verified: body.verified === true,
          digest: truncateHex(body.digest),
          exports: Array.isArray(manifest.exports)
            ? manifest.exports.length
            : 0,
        };
      },
      assert: (payload) =>
        asRecord(payload).verified === true
          ? null
          : "on-chain account did not verify against these sources",
    },
    {
      id: "import",
      label: `GET /mtst/import/${COUNTER_CONTRACT_ID_1}`,
      method: "GET",
      path: `/mtst/import/${COUNTER_CONTRACT_ID_1}`,
      summarize: (payload) => {
        const body = asRecord(payload);
        const expected = accounts[COUNTER_CONTRACT_ID_1]?.code;
        return {
          type: String(body.type ?? "—"),
          code: truncateHex(body.code),
          matches: body.code === expected,
        };
      },
      assert: (payload) => {
        const body = asRecord(payload);
        if (body.type !== "account")
          return `expected an account, got ${body.type}`;
        const expected = accounts[COUNTER_CONTRACT_ID_1]?.code;
        return body.code === expected
          ? null
          : "code root does not match the known fixture";
      },
    },
  ],
};

const apiRegistry: ServiceDefinition = {
  id: "api-registry",
  name: "api-registry",
  description:
    "Registry of verified accounts, notes and their source packages.",
  url: API_REGISTRY_URL,
  // `GET /` only echoes env vars and never touches Postgres, so these four
  // record lookups are what actually prove the registry can serve. All four are
  // network-scoped; the by-root pair is a pure database read, the by-id pair
  // additionally calls api-compile to resolve the on-chain root first (see
  // api-registry/src/lib/import-resource.ts), so an api-compile outage
  // degrades this service too.
  endpoints: [
    rootCheck,
    verifiedAccountCheck({ byId: false }),
    verifiedAccountCheck({ byId: true }),
    verifiedNoteCheck({ byId: false }),
    verifiedNoteCheck({ byId: true }),
  ],
};

const webVerifier: ServiceDefinition = {
  id: "web-verifier",
  name: "web-verifier",
  description: "Browser app for submitting sources to be verified.",
  url: WEB_VERIFIER_URL,
  // Serves the SPA's HTML rather than JSON, so only reachability is checked.
  endpoints: [{ ...rootCheck, showPayload: false }],
};

// Cards render in this order. api-compile goes last: it has by far the most
// checks and the busiest card, so the two lighter services read first.
const services: ServiceDefinition[] = [apiRegistry, webVerifier, apiCompile];

const probeEndpoint = async (
  serviceUrl: string,
  check: EndpointCheck,
): Promise<EndpointStatus> => {
  const endpoint = new URL(check.path, serviceUrl).toString();
  const base = {
    id: check.id,
    label: check.label,
    summary: null,
    payload: null,
  };
  const startedAt = performance.now();

  try {
    const body = check.body ? JSON.stringify(await check.body()) : undefined;
    const response = await fetch(endpoint, {
      method: check.method,
      signal: AbortSignal.timeout(check.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        accept: check.method === "POST" ? "application/json" : "*/*",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
    });
    const responseTimeMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ...base,
        health: "unhealthy",
        httpStatus: response.status,
        responseTimeMs,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    // Nothing to inspect — reachability was the whole check.
    if (!check.showPayload && !check.summarize && !check.assert) {
      return {
        ...base,
        health: "healthy",
        httpStatus: response.status,
        responseTimeMs,
        error: null,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A 200 that isn't the documented JSON means the endpoint's contract is
      // broken, so it counts as unhealthy rather than merely undisplayable.
      return {
        ...base,
        health: "unhealthy",
        httpStatus: response.status,
        responseTimeMs,
        error: "Response body was not valid JSON",
      };
    }

    const assertion = check.assert?.(payload) ?? null;
    return {
      ...base,
      health: assertion === null ? "healthy" : "unhealthy",
      httpStatus: response.status,
      responseTimeMs,
      summary: check.summarize?.(payload) ?? null,
      payload: check.showPayload ? payload : null,
      error: assertion,
    };
  } catch (error) {
    return {
      ...base,
      health: "unhealthy",
      httpStatus: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
};

const rollUp = (endpoints: EndpointStatus[]): ServiceHealth => {
  const healthy = endpoints.filter(
    (endpoint) => endpoint.health === "healthy",
  ).length;
  if (healthy === endpoints.length) return "healthy";
  return healthy === 0 ? "unhealthy" : "degraded";
};

const probeService = async (
  service: ServiceDefinition,
): Promise<ServiceStatus> => {
  // Sequential within a service: `GET /` runs first and wakes api-compile's
  // container, so the compile checks behind it don't each pay a cold start.
  const endpoints: EndpointStatus[] = [];
  for (const check of service.endpoints) {
    endpoints.push(await probeEndpoint(service.url, check));
  }
  const { endpoints: _definitions, ...rest } = service;
  return { ...rest, health: rollUp(endpoints), endpoints };
};

// Every check is individually caught above and this script always exits 0. A
// service being down must still produce a status page — that is precisely when
// someone is looking at it.
const snapshot: StatusSnapshot = {
  checkedAt: new Date().toISOString(),
  // Services in parallel; their own checks run sequentially.
  services: await Promise.all(services.map(probeService)),
};

const outDir = path.resolve(import.meta.dirname, "..", "public");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "status.json"),
  JSON.stringify(snapshot, null, 2),
);

for (const service of snapshot.services) {
  const healthy = service.endpoints.filter(
    (endpoint) => endpoint.health === "healthy",
  ).length;
  console.log(
    `${service.name}: ${service.health} (${healthy}/${service.endpoints.length})`,
  );
  for (const endpoint of service.endpoints) {
    const state =
      endpoint.health === "healthy" ? "ok" : `FAILED — ${endpoint.error}`;
    console.log(
      `  ${endpoint.label} — ${state} in ${endpoint.responseTimeMs}ms`,
    );
  }
}
