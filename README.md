# Miden Sourcify

Miden Sourcify is a set of self-hostable services for verifying that on-chain Miden accounts and notes correspond to specific Rust source packages.

## Architecture overview

4 services, deployable independently or together:

1. **Compilation & Verification API** — stateless, compute-heavy, Rust-in-container.
2. **Verified Accounts & Notes Registry API** — stateful, Node.js + Postgres, delegates compute to (1).
3. **Verify frontend** — static webapp talking to (2). (planned)
4. **Contract viewer frontend** _(optional)_ — static webapp talking to (2). (planned)

The registry never compiles or verifies on its own; it always delegates to the Compilation API and persists the result. This keeps the heavy Rust toolchain isolated from the database tier.

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose`, BuildKit enabled by default).
- For host-side development (optional): [Node.js](https://nodejs.org) 24+ and [pnpm](https://pnpm.io) (`corepack enable`).

### Run the backend stack

From the repository root:

```bash
docker compose up --build
```

This builds and starts everything in the right order:

1. **postgres** — the database.
2. **api-registry-migrate** — a one-shot job that applies the Drizzle migrations, then exits.
3. **api-compile** (`http://localhost:8080`) — compilation & verification API.
4. **api-registry** (`http://localhost:8081`) — the registry API, started only after the migration succeeds and `api-compile` is healthy.

No `.env` files are required — the compose file ships sensible dev defaults.

> **First build is slow.** `api-compile` bundles a full Rust toolchain and pre-builds the Miden tooling, so the initial build can take tens of minutes. Subsequent builds are cached and fast.

Once it's up, check the services:

```bash
curl http://localhost:8080/   # api-compile
curl http://localhost:8081/   # api-registry
```

Postgres is exposed on host port **5433** (override with `POSTGRES_PORT`) to avoid clashing with a local Postgres.

### Stop

```bash
docker compose down       # stop the stack
docker compose down -v    # also wipe the database volume
```

### Develop a service outside Docker (optional)

Each service can also run on the host with [pnpm](https://pnpm.io). For example, to develop the registry API while the rest of the stack runs in Docker:

```bash
pnpm install
cp apps/api-registry/.env.example apps/api-registry/.env   # then edit as needed

# The registry needs Postgres + api-compile reachable, so start those first:
docker compose up -d postgres api-compile
pnpm --filter miden-sourcify-api-registry dev
```

(The defaults in `.env.example` expect Postgres on `localhost:5433` and api-compile on `localhost:8080`, matching the compose stack above.)

## API documentation

Interactive OpenAPI (Swagger UI) docs for the **Registry API** are published live at:

**https://walnuthq.github.io/miden-sourcify/**

The docs are generated from the `api-registry` route annotations by the `api-docs` app and deployed to GitHub Pages. To preview them locally:

```bash
pnpm --filter miden-sourcify-api-docs dev   # serves the docs at http://localhost:8082
```

## Deployment

The backend services run anywhere Docker does (see the `Dockerfile` in each `apps/*` service).

A [Cloudflare Workers](https://workers.cloudflare.com) deployment path is also provided via dedicated, opt-in packages:

```bash
pnpm --filter miden-sourcify-api-compile-cloudflare cf:deploy
pnpm --filter miden-sourcify-api-registry-cloudflare cf:deploy
```

These wrap the vendor-neutral services; deleting them removes Cloudflare with no impact on the core apps.

## License

MIT
