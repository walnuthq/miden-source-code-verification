# status-page

Public status page for the three deployed services — `api-compile`,
`api-registry` and `web-verifier`. Published to GitHub Pages at
**https://walnuthq.github.io/miden-source-code-verification/status/**.

## How it works

Two phases, both at build time:

1. `scripts/probe.ts` runs each service's checks and writes the results to
   `public/status.json`.
2. Vite builds the React app, copying that snapshot into `dist/` alongside
   `index.html`. The page fetches it at runtime (same-origin, no CORS).

Probing happens on the CI runner rather than in the browser because
`api-registry`'s CORS allowlist has no `github.io` entry and `web-verifier` sends
no CORS headers — client-side checks would simply be blocked.

## The checks

| Service | Check | Asserts | Card shows |
| --- | --- | --- | --- |
| api-compile | `GET /` | 200 + JSON | the payload in full |
| api-compile | `POST /compile` | a package came back (a compile failure still returns 200 with no `masp`, so the status code alone would miss it) | digest, exports, dependencies, sizes |
| api-compile | `POST /verify` | `verified === true` | verified, digest, exports |
| api-compile | `GET /:networkId/import/:resourceId` | `type` is an account and `code` matches the fixture | type, code, ✓ matches |
| api-registry | `GET /` | 200 + JSON | the payload in full |
| api-registry | `GET /v1/verified-accounts/:code` | the code root comes back unchanged, ≥1 component | code, components, package, source |
| api-registry | `GET /v1/:networkId/verified-accounts/:accountId` | above, plus the echoed id and network | the same, plus accountId and networkId |
| api-registry | `GET /v1/verified-notes/:script` | the script root comes back unchanged, package is a note | script, package, source files, source |
| api-registry | `GET /v1/:networkId/verified-notes/:noteId` | above, plus the echoed id and network | the same, plus noteId and networkId |
| web-verifier | `GET /` | 200 | — (serves HTML; reachability only) |

`api-registry`'s `GET /` only echoes env vars and never opens a database
connection, so the four record lookups are what actually prove the registry can
serve. The by-root pair is a pure Postgres read; **the by-id pair additionally
calls api-compile** to resolve the on-chain root before the lookup (see
`apps/api-registry/src/lib/import-resource.ts`), so an api-compile outage will
degrade the api-registry card too. Note also that those routes answer 404 both
when a record is absent and when the on-chain lookup fails — the two are
indistinguishable from outside.

The compile checks submit
`apps/api-compile/examples/counter-contract/counter-contract` and the on-chain IDs
come from `packages/test-utils` — the same sources and fixtures the api-compile
test suite uses, so a change to either reaches both at once. **Nothing about the
dataset is duplicated here.** The checks mirror `it compiles a counter-contract`,
`it verifies an on-chain counter-contract` and `it imports an on-chain account`.

`/compile` and `/verify` each return ~80 KB (77 KB of it base64 `masp`), so the
probe records a small summary rather than the raw body.

A service's checks run **sequentially** so `GET /` wakes api-compile's container
before the compile checks run and they don't each pay a cold start; services run
in parallel with each other.

**A failing check never fails the build.** Every check is caught individually and
the script always exits 0. A service is green when all its checks pass, amber
("degraded") when only some do, red when none do — `POST /verify` reaches the
Miden testnet, so it can fail while api-compile itself is fine, and that must not
read the same as the service being down.

## Configuration

| Variable | Default |
| --- | --- |
| `API_COMPILE_URL` | `http://localhost:8080` |
| `API_REGISTRY_URL` | `http://localhost:8081` |
| `WEB_VERIFIER_URL` | `http://localhost:5173` |

In CI these come from repository variables of the same name. Locally, copy
`.env.example` to `.env` (see `docker-compose.yml` to run the services).

`STATUS_PAGE_BASE` overrides Vite's `base`, which defaults to the Pages subpath
`/miden-source-code-verification/status/`.

## Build & preview

```bash
# Probe, typecheck, build into dist/
pnpm --filter miden-source-code-verification-status-page build

# Probe against production and preview from the root path
API_COMPILE_URL=https://miden-source-code-verification-api-compile.walnut.dev \
API_REGISTRY_URL=https://miden-source-code-verification-api-registry.walnut.dev \
WEB_VERIFIER_URL=https://miden-source-code-verification-web-verifier.walnut.dev \
STATUS_PAGE_BASE=/ \
  pnpm --filter miden-source-code-verification-status-page build

pnpm --filter miden-source-code-verification-status-page preview
```

## Deployment

`.github/workflows/deploy-pages.yml` builds this app **and** `api-docs` into a
single Pages artifact — docs at the site root, this page under `/status/`. That
workflow is the only one allowed to deploy Pages: a repository has exactly one
Pages deployment, and a second workflow would overwrite the first on every run.

It runs every 30 minutes on a cron, on the hour and the half hour. Do not shorten
that interval without reading the note in the workflow about `api-compile`'s
container sleep.

## UI

Everything visual comes from `packages/ui`, the same design system
`web-verifier` uses. See its README before adding components.
