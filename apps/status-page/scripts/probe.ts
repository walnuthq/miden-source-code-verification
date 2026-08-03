import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import type { ServiceStatus, StatusSnapshot } from "../src/lib/types.js";

// Build-time probe. Runs on the CI runner (see .github/workflows/deploy-pages.yml)
// rather than in the browser, because api-registry's CORS allowlist has no
// github.io entry and web-verifier serves no CORS headers at all — the checks
// simply would not be permitted client-side.
//
// The output is written to public/, so Vite copies it into dist/ verbatim and the
// page fetches it at runtime. Keeping it out of the module graph means a fresh
// checkout can `pnpm typecheck` and `pnpm build` without the file existing yet.

const API_COMPILE_URL = process.env.API_COMPILE_URL ?? "http://localhost:8080";
const API_REGISTRY_URL =
  process.env.API_REGISTRY_URL ?? "http://localhost:8081";
const WEB_VERIFIER_URL =
  process.env.WEB_VERIFIER_URL ?? "http://localhost:5173";

// Generous: api-compile's `/` proxies into a Cloudflare Container that may be
// asleep, and a cold start costs several seconds.
const TIMEOUT_MS = 15_000;

type ServiceDefinition = Pick<
  ServiceStatus,
  "id" | "name" | "description" | "url" | "kind"
>;

const services: ServiceDefinition[] = [
  {
    id: "api-compile",
    name: "api-compile",
    description:
      "Compiles Rust sources to Miden packages and verifies them against on-chain code.",
    url: API_COMPILE_URL,
    kind: "json",
  },
  {
    id: "api-registry",
    name: "api-registry",
    description:
      "Registry of verified accounts, notes and their source packages.",
    url: API_REGISTRY_URL,
    kind: "json",
  },
  {
    id: "web-verifier",
    name: "web-verifier",
    description: "Browser app for submitting sources to be verified.",
    url: WEB_VERIFIER_URL,
    kind: "liveness",
  },
];

const probe = async (service: ServiceDefinition): Promise<ServiceStatus> => {
  const endpoint = new URL("/", service.url).toString();
  const startedAt = performance.now();

  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: service.kind === "json" ? "application/json" : "*/*",
      },
    });
    const responseTimeMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ...service,
        healthy: false,
        httpStatus: response.status,
        responseTimeMs,
        payload: null,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    if (service.kind === "liveness") {
      return {
        ...service,
        healthy: true,
        httpStatus: response.status,
        responseTimeMs,
        payload: null,
        error: null,
      };
    }

    // A 200 that isn't the documented JSON means the endpoint's contract is
    // broken, so it counts as unhealthy rather than merely undisplayable.
    try {
      return {
        ...service,
        healthy: true,
        httpStatus: response.status,
        responseTimeMs,
        payload: await response.json(),
        error: null,
      };
    } catch {
      return {
        ...service,
        healthy: false,
        httpStatus: response.status,
        responseTimeMs,
        payload: null,
        error: "Response body was not valid JSON",
      };
    }
  } catch (error) {
    return {
      ...service,
      healthy: false,
      httpStatus: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      payload: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
};

// Every probe is individually caught above and this script always exits 0. A
// service being down must still produce a status page — that is precisely when
// someone is looking at it.
const snapshot: StatusSnapshot = {
  checkedAt: new Date().toISOString(),
  services: await Promise.all(services.map(probe)),
};

const outDir = path.resolve(import.meta.dirname, "..", "public");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "status.json"),
  JSON.stringify(snapshot, null, 2),
);

for (const service of snapshot.services) {
  const state = service.healthy ? "healthy" : `unhealthy (${service.error})`;
  console.log(`${service.name}: ${state} in ${service.responseTimeMs}ms`);
}
