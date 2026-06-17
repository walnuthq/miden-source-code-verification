# Miden Source Code Verification PRD

## Summary

Miden Source Code Verification is a set of self-hostable services for verifying that on-chain Miden accounts and notes correspond to specific Rust source packages. It extracts the verification logic currently baked into the miden-playground API into an independently deployable monorepo, enabling the broader Miden ecosystem (explorers, wallets, third-party developers) to run their own verifier and reducing reliance on a single hosted instance.

## Background & motivation

Today, Miden contract verification lives inside the miden-playground API. This creates two problems:

- **Coupling.** The playground owns logic that other tools (block explorers, CLIs, dApps) increasingly need.
- **Centralization.** A single hosted verifier is a trust and availability bottleneck for an ecosystem that values verifiability.
- **Scaling.** Extracting and separating the monolith in separate dedicated services will allow better scaling and avoid single point of failure as well as setup appropriate rate-limiting.

Extracting verification into standalone services — inspired by Ethereum's [Sourcify](https://github.com/sourcifyeth/verify.sourcify.dev) — lets anyone run the full stack, scale components independently, and treat verified-source data as a public good.

## Goals

- Provide a standalone, self-hostable verification stack for Miden accounts and notes.
- Offer fast (~5–6s warm latency) compilation of Miden Rust packages.
- Maintain a queryable registry of verified accounts and notes per network.
- Ship a developer-friendly web UI for submitting verifications.
- Make each service independently deployable (compile API, registry API, frontends).

## Users & use cases

- **dApp developers** verifying their own deployed accounts and notes so users can trust them.
- **Block explorers & wallets** querying the registry to display "verified" badges and source code.
- **Miden Playground** delegating its verification flow to the new service.
- **Ecosystem operators** self-hosting the stack for sovereignty or compliance.

## Verification model

Define terms once:

- **MASP** — Miden Assembly Package, the compiled artifact emitted by `cargo-miden`.
- **Account component** — a reusable bundle of procedures attached to an account (e.g. `NoAuth`, `BasicWallet`).
- **Procedure root** — a hash uniquely identifying a compiled procedure.
- **Note script root** — a hash uniquely identifying a compiled note script.

### Account verification

An account is verified against a component by checking that the account's on-chain code contains every procedure root declared in the component's MASP manifest. An account may have multiple verified components.

> **Example.** A Counter Contract account implements both `NoAuth` and a custom `CounterContract` component exposing `get_count` and `increment_count`. Verifying it produces two matched components. Without the custom component verification, the API should still detect the presence of the `NoAuth` component.

### Note verification

A note is verified by comparing its on-chain script root to the script root in a candidate compiled note package's digest. A match means the note's script corresponds to the submitted package.

### Standard vs. custom

The service automatically detects standard components (`NoAuth`, `BasicWallet`, …) and standard notes (`P2ID`, `MINT`, …) without requiring prior submission. Custom components and notes must be submitted and verified first before they appear in lookups.

## Architecture overview

4 services, deployable independently or together:

1. **Compilation & Verification API** — stateless, compute-heavy, Rust-in-container.
2. **Verified Accounts & Notes Registry API** — stateful, Node.js + Postgres, delegates compute to (1).
3. **Verify frontend** — static webapp talking to (2).
4. **Contract viewer frontend** _(optional)_ — static webapp talking to (2).

The registry never compiles or verifies on its own; it always delegates to the Compilation API and persists the result. This keeps the heavy Rust toolchain isolated from the database tier.

## Services

Each service below follows the same template: **Purpose / Stack / Dependencies / Endpoints / Deployment notes**.

### 1. Compilation & Verification API

**Purpose.** Fast compilation of Miden Rust packages (target is around 5/6 seconds) and stateless verification of accounts and notes against submitted source.

**Stack.** Node.js for top-level orchestration; a Rust container handles compilation (via `cargo-miden`), MASP manifest parsing, on-chain code fetching, and verification logic. Designed for serverless container platforms (e.g. Cloudflare Containers). Challenges include fast compilation even on cold starts (use a single, pre-warmed target directory) and potential concurrency issues (might be solved by the Cloudflare Container approach allowing the API to spawn a new container for each request).

**Dependencies.** Reads from Miden node RPC for on-chain account/note data. No database.

**Endpoints.**

- `POST /compile`
  - **Body** (`application/json`): `{ source: { cargoToml: string, rust: string }, dependencies?: Array<{ name: string, cargoToml: string, rust: string }> }`
  - **Response.** Server-sent event stream of compiler output, terminating with `{ ok: true, masp: <base64>, exports: Export[] }` or `{ ok: false, error: <string> }`.
  - **Errors.** `400` malformed source, `422` compile failure, `504` timeout.
- `POST /verify-account-component`
  - **Body**: `{ network: "mtst" | "mdev", accountId: string, package: { cargoToml, rust } }`
  - **Response.** `{ verified: boolean, exports: Export[] }`
  - **Errors.** `400`, `404` (account not found on network), `422`, `504`.
- `POST /verify-note`
  - **Body**: `{ network, noteId, package }`
  - **Response.** `{ verified: boolean }`
  - **Errors.** as above.

**Auth.** Open by default; rate-limited per IP. Operators can require an API key via env var.

### 2. Verified Accounts & Notes Registry API

**Purpose.** Authoritative read/write registry of verified resources. Delegates the actual verification to the Compilation & Verification API and persists successful results.

**Stack.** Node.js + Postgres.

**Dependencies.** Compilation & Verification API (HTTP), Postgres.

**Endpoints.**

- `GET /:network/verified-accounts/:accountId`
  - **Response.** `{ components: Array<{ id, name, type, rust?, exports: Export[] }> }`
  - Standard components are always included even if never explicitly submitted.
- `POST /:network/verified-accounts`
  - **Body**: `{ accountId, packageSource: { cargoToml, rust } }`
  - **Behavior.** Calls Compilation API's `/verify-account-component`. On success, inserts a row and returns `201` with the new component record. On failure, returns `422` with the verifier's error payload.
  - **Idempotency.** Re-submitting an already-verified `(accountId, accountComponentPackageDigest)` pair returns `200` with the existing record.
- `GET /:network/verified-notes/:noteId`
  - **Response.** `{ noteScript: { id, name, type, rust?, dependencies: Array<{ id, name, type, digest, rust }> | null }`
- `POST /:network/verified-notes`
  - **Body**: `{ noteId, packageSource: { cargoToml, rust } }`
  - **Behavior.** Same delegation pattern as accounts.

**Auth.** Reads are public. Writes are open but rate-limited per IP; operators can gate writes behind an API key.

### 3. Verify frontend

**Purpose.** Developer-facing UI for submitting account and note verifications. Inspired by [verify.sourcify.dev](http://verify.sourcify.dev).

**Stack.** Vite + Miden React SDK + shadcn/ui.

**Screens.**

- Network selector + account/note ID input.
- Source upload (upload `Cargo.toml` + `src/lib.rs`, plus optional dependencies via file picker).
- Verification result with

**Auth.** None. No login required to submit a verification.

**Hosting.** Static; deployable to any CDN.

### 4. Contract viewer frontend _(optional, post-v1)_

**Purpose.** Browse verified accounts and notes from the registry, with source code rendering and procedure listings, inspired by [repo.sourcify.dev](http://repo.sourcify.dev).

**Stack.** Vite + Miden React SDK + shadcn/ui.

**Screens.** Search by ID, account detail page (components + source), note detail page (script + source).

## Data model (Registry API)

Sketch — to be refined during implementation.

```sql
CREATE TABLE verified_account_components (
  id              UUID PRIMARY KEY,
  network         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  component_name  TEXT,
  procedure_roots TEXT[] NOT NULL,
  cargo_toml      TEXT NOT NULL,
  rust            TEXT NOT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, account_id, procedure_roots)
);

CREATE TABLE verified_notes (
  id           UUID PRIMARY KEY,
  network      TEXT NOT NULL,
  note_id      TEXT NOT NULL,
  script_root  TEXT NOT NULL,
  cargo_toml   TEXT NOT NULL,
  rust.        TEXT NOT NULL,
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, note_id)
);
```

## Monorepo layout

```
miden-source-code-verification/
├── apps/
│   ├── api-compile/      # Node orchestrator + Rust container
│   ├── api-registry/     # Node + Postgres
│   ├── web-verify/       # Vite frontend
│   └── web-viewer/       # Vite frontend (optional)
├── packages/
│   ├── shared-types/     # TS types shared across apps
│   └── verifier-core/    # Rust crate: MASP parsing + matching
└── infra/
    └── docker/           # Containerfiles, compose files
```

## Deployment & self-hosting

- Each app ships its own `Dockerfile`. A top-level `docker-compose.yml` brings up the full stack with one command for local dev and small self-hosted deployments.
- The Compilation API's Rust container is the only heavy artifact and is the primary target for serverless container platforms.
- The Registry API requires a Postgres instance; operators can point it at any managed Postgres.
- Frontends are static and host-anywhere.

## Security & abuse

- Rate limiting per IP on all `POST` endpoints.
- Source-size limits on `/compile` (e.g. 1 MB total) to bound compute.
- Compile timeouts enforced in the Rust container.
- Optional API-key gating for write endpoints, configurable via env var.
- No user accounts, no PII stored.

## Networks at launch

- **Testnet & Devnet**: required for v1.
- **Mainnet**: required for v1 if available at ship time; otherwise fast-follow.

## Open questions

- How do we handle source updates for the same `(account, component)` pair — overwrite, version, or reject? What about upgradable accounts whose on-chain MASM can be updated over time?
- Should `cargo-miden` versions be pinned per-verification, and surfaced in the registry response?
