# status-page

Public status page for the three deployed services — `api-compile`,
`api-registry` and `web-verifier`. Published to GitHub Pages at
**https://walnuthq.github.io/miden-source-code-verification/status/**.

## How it works

Two phases, both at build time:

1. `scripts/probe.ts` does a `GET /` against each service and writes the result to
   `public/status.json`.
2. Vite builds the React app, copying that snapshot into `dist/` alongside
   `index.html`. The page fetches it at runtime (same-origin, no CORS).

The two API services return JSON from `/`, which is rendered in full on the card.
`web-verifier` serves the SPA's HTML, so only reachability is checked.

Probing happens on the CI runner rather than in the browser because
`api-registry`'s CORS allowlist has no `github.io` entry and `web-verifier` sends
no CORS headers — client-side checks would simply be blocked.

**A failing service never fails the build.** Every probe is caught individually
and the script always exits 0; an unreachable service becomes a red card. A
status page that disappears when something breaks would be worse than useless.

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

It runs hourly on a cron. Do not shorten that interval without reading the note
in the workflow about `api-compile`'s container sleep.

## UI

Everything visual comes from `packages/ui`, the same design system
`web-verifier` uses. See its README before adding components.
