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
| api-registry | `GET /v1/:networkId/verified-accounts/code/:code` | the code root and network come back unchanged, ≥1 component | networkId, code, components, package, source |
| api-registry | `GET /v1/:networkId/verified-accounts/:accountId` | above, plus the echoed id | the same, plus accountId |
| api-registry | `GET /v1/:networkId/verified-notes/script/:script` | the script root and network come back unchanged, package is a note | networkId, script, package, source files, source |
| api-registry | `GET /v1/:networkId/verified-notes/:noteId` | above, plus the echoed id | the same, plus noteId |
| web-verifier | `GET /` | 200 | — (serves HTML; reachability only) |

`api-registry`'s `GET /` only echoes env vars and never opens a database
connection, so the four record lookups are what actually prove the registry can
serve. All four are network-scoped, since records are keyed on the network plus
the root. The by-root pair is a pure Postgres read; **the by-id pair additionally
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

| Variable | Default | Used by |
| --- | --- | --- |
| `API_COMPILE_URL` | `http://localhost:8080` | probe |
| `API_REGISTRY_URL` | `http://localhost:8081` | probe |
| `WEB_VERIFIER_URL` | `http://localhost:5173` | probe |
| `STATUS_PAGE_URL` | derived from the repo | probe (previous state), notify |
| `SLACK_WEBHOOK_URL` | unset — notify is a no-op | notify |
| `STATUS_PAGE_BASE` | `/miden-source-code-verification/status/` | Vite's `base` |

The three service URLs come from repository **variables** of the same name in CI,
and all three are required: an undefined variable reaches the build as an empty
string, the probe falls back to the localhost defaults above, and the published
page is a wall of connection failures. `SLACK_WEBHOOK_URL` is a **secret**, not a
variable. Locally, copy `.env.example` to `.env` (see `docker-compose.yml` to run
the services).

## Slack notifications

`scripts/notify.ts` posts to a Slack channel when a service's health changes.

**The design goal is silence.** The probe runs every 30 minutes, so a naive
implementation would post 48 identical "api-compile is down" messages a day and
the channel would be muted within a week. It therefore speaks only on a
transition, plus a reminder every 6 hours while an outage continues:

| Previous | Current | Message |
| --- | --- | --- |
| none | not healthy | 🔴/🟡 the current state — new to the channel |
| healthy | degraded/unhealthy | 🟡 `api-registry` is degraded / 🔴 `api-compile` is down |
| degraded ↔ unhealthy | changed | the new state, so escalations are visible |
| not healthy | healthy | ✅ `api-compile` recovered — after 1h 30m down |
| unchanged, not healthy | 6h boundary crossed | 🔴 `api-compile` is still down (6h) |
| anything else | | **silence** |

Each message leads with a link to the service that is down, lists the failing
checks with the probe's one-line diagnosis, and links to the status page and the
workflow run. Two services failing together produce one message with two coloured
attachments, so it is a single ping.

### How it remembers, without a state store

`notify.ts` writes nothing and keeps no database. Everything it needs is in the
snapshot, because `scripts/probe.ts` fetches the **previously published**
`status.json` from the Pages URL before writing the new one and carries three
fields forward:

```jsonc
{
  "checkedAt": "2026-08-13T12:00:00.000Z",
  "previousCheckedAt": "2026-08-13T11:30:00.000Z",
  "services": [
    { "health": "unhealthy", "previousHealth": "healthy", "since": "…" },
  ],
}
```

Reminders are then _derived_ rather than stored — a reminder is due when this run
is the first past a 6-hour multiple of `since`:

```ts
Math.floor((checkedAt - since) / SIX_HOURS) >
  Math.floor((previousCheckedAt - since) / SIX_HOURS);
```

That is worth the paragraph it takes to explain, because it means nothing can
desynchronise: a failed deploy or a lost snapshot cannot double-fire or silence
the cadence, since the next run recomputes it from the same two timestamps. A
delayed cron that skips eight hours produces one reminder, not sixteen.

`since` also feeds the page itself — a service that is not healthy shows "Down
since 13 Aug 2026, 09:12 UTC" rather than only the time of the last check.

Both scripts get that Pages URL from `scripts/status-page-url.ts`. Note the
`/status/` segment: `api-docs` owns the root of this repository's Pages site, so
the snapshot is at
`https://walnuthq.github.io/miden-source-code-verification/status/status.json`.

### Setting it up

1. **Slack** — https://api.slack.com/apps → _Create New App_ → _From scratch_ →
   name it and pick the workspace → _Incoming Webhooks_ → toggle **On** → _Add
   New Webhook to Workspace_ → choose the channel → copy the
   `https://hooks.slack.com/services/…` URL. Some workspaces require an admin to
   approve the app.
2. **GitHub** — Settings → Secrets and variables → Actions → **Secrets** → new
   repository secret named `SLACK_WEBHOOK_URL`. A secret rather than a variable:
   anyone holding that URL can post to the channel, and secrets are masked in
   logs.

Without the secret the notify step logs `SLACK_WEBHOOK_URL is not set` and exits
0, so forks and local builds stay silent and nothing breaks.

### Testing it without an outage

`notify.ts` is a pure function of `public/status.json`, so every branch can be
driven from a hand-edited file:

```sh
# Print the payload instead of posting it
pnpm notify --dry-run

# Manufacture an outage, then see what would be posted
API_COMPILE_URL=http://localhost:9999 pnpm probe
pnpm notify --dry-run
```

Edit `health`, `previousHealth`, `since` and `previousCheckedAt` in
`public/status.json` to reach the recovery and reminder branches. To post for
real from your machine, put the webhook in `apps/status-page/.env` and drop
`--dry-run`.

### Limits

- **The memory is the last successful deploy.** If a deploy fails, the next run
  sees no previous state and may repeat an "is down" message. It can repeat
  itself, never miss an outage.
- **`STATUS_PAGE_URL` is unset locally on purpose.** A local run that read the
  published snapshot could post a duplicate outage to the real channel.
- **One channel**, fixed when the webhook is created. Per-service routing would
  need a bot token instead.
- **No threading or editing** for the same reason: recovery is a new message, not
  a reply under the outage. Moving to a bot token later is additive — store the
  message `ts` in the snapshot the same way `since` is stored.
- **A 30-minute floor on detection.** An outage that starts and ends between two
  probes is never seen.

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
single Pages artifact — docs at the site root, this page under `/status/` — then
runs the Slack notify step against the snapshot the build just wrote. That
workflow is the only one allowed to deploy Pages: a repository has exactly one
Pages deployment, and a second workflow would overwrite the first on every run.

It runs every 30 minutes on a cron, on the hour and the half hour. Do not shorten
that interval without reading the note in the workflow about `api-compile`'s
container sleep.

## UI

Everything visual comes from `packages/ui`, the same design system
`web-verifier` uses. See its README before adding components.
