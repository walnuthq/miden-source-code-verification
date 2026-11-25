# Plan 05: The registry accepts MASM

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Read `docs/claude/database-migrations.md` and `docs/claude/registry-backfill.md` before touching the schema or the admin routes. Drift check: `git diff --stat ba261ab..HEAD -- apps/api-registry/src packages/utils/src`, and confirm plans 03 and 04 are merged and deployed.

- **Rollout step**: 3
- **Effort**: M
- **Risk**: MEDIUM (the production registry; Rust records must keep working)
- **Depends on**: 03, 04
- **Branch**: `feat/registry-masm`

## Goal

The registry verifies, stores and serves a MASM project as it does a Rust one. Rust records and MASM records live side by side until plan 09. No schema change.

## Current state

- `apps/api-registry/src/lib/verify-resource.ts` sends a project to api-compile's `/verify` and writes the record (`verified-record.ts`, `db/packages.ts`). `lib/api-compile.ts` is the port to api-compile.
- `db/schema.ts`, `packages` table: `built_with` and `debug_built_with` are documented as cargo-miden versions, `parameters` as read from WIT, `schemas` holds the storage schemas, `files` holds the sources with `Cargo.lock`.
- `lib/debug-build.ts` and the `.debug.masp` route serve a second, debug package; `storage/masp-store.ts` stores both files.
- `packageMaspPath` names the download as Rust spells the crate (`counter_contract.masp`).
- The OpenAPI annotations in `app.ts` and `routes/v1/*.ts` describe a "compiled Rust source package", `Cargo.toml` and `Cargo.lock`. `apps/api-docs` publishes them.
- The registry validates uploaded projects with `packages/utils/src/project.ts`, which plan 03 taught about MASM projects.

## Steps

1. Follow a MASM project through `POST /v1/{network}/verified-accounts` and `/verified-notes` and fix what assumes Rust: the validation messages, the record written, the files stored.
2. Columns keep their names with wider meanings: `built_with` takes api-compile's `builtWith` for a MASM package; `schemas` is null; `parameters` holds the names read from the source; `files` holds the project without a lockfile. Update the schema's comments. No migration.
3. Debug package. A MASM package is one dev package (decision 5). For a MASM row: don't request or store a second build; `debug_built_with` and the debug commitment stay null. The `.debug.masp` route answers a MASM row with the one stored package and its commitment in `X-Debug-Commitment`, so Walnut's simulator keeps working unchanged until plan 09 removes the route.
4. `packageMaspPath`: for a MASM package use the `[package] name` with `-` turned into `_`, the same spelling as today, so download names don't change shape.
5. Telling the two kinds apart, where code must: a row is Rust-built when its `files` hold a `Cargo.toml` at the entrypoint. No new column (decision 6).
6. Admin routes that rebuild from stored sources (`routes/admin.ts`, the debug-build backfill): skip MASM rows, which need no debug backfill.
7. The Playground promotion and cleanup paths (`lib/playground.ts`, `lib/cleanup-playground.ts`): check they don't read a Rust-only field.
8. OpenAPI: describe both project kinds for now ("a Miden project: MASM, or Rust until its removal").
9. Tests in `apps/api-registry/__tests__/`: verify the MASM fixtures from plan 04 (account and note), read them back through the package, sources, `.masp` and `.debug.masp` routes, and check `schemas` is null and `parameters` has names. `fake-api-compile.ts` gains a MASM answer. Existing tests stay green.

## Verification

- `pnpm check` passes.
- Rebuilt compose stack: `pnpm --filter ./apps/api-registry test` passes.
- By hand against `localhost:8081`: verify the MASM counter account, then fetch its record, its sources and both `.masp` routes.

## STOP conditions

- A MASM record needs a schema change to be stored.
- The Rust path's stored record changes in any column.

## Out of scope

Refusing or deleting Rust (plan 09), the web apps (plans 06 and 07), dropping columns (plan 10).
