# Plan 09: The registry and the web apps drop Rust

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Read `docs/claude/database-migrations.md`, `registry-backfill.md` and `deploys.md`. This plan deletes production rows and stored files: **the deletion runs only on the user's go-ahead in your session, and only the user decides when**. Write and test the code; don't run it against production yourself. Drift check: confirm plan 08 is ready on its branch or merged.

- **Rollout step**: 6
- **Effort**: M
- **Risk**: HIGH (destructive on the production database and bucket)
- **Depends on**: 08
- **Branch**: `feat/registry-drops-rust`

## Goal

The registry refuses Rust projects, holds no Rust-built package, and no longer has a debug package. The viewer and the verifier form know only MASM. Decisions 5 and 6.

## What the deletion means (decision 6)

Every Rust-built package, the verified accounts and notes that point at it, and its stored `.masp` and `.debug.masp` files are deleted, on every network including Mainnet. Those accounts and notes show as not verified afterwards, until someone verifies them again from MASM, which can only succeed for code redeployed from MASM. The user chose this over keeping the records marked as Rust-built.

## Steps

1. **Refuse Rust.** An upload with a `Cargo.toml` at its entrypoint gets a 400 whose message is written for the `miden-verify` CLI's users, since the released CLI prints it as is: "Rust projects are no longer verified. Miden projects are written in MASM: upload a `miden-project.toml` project. If you use the `miden verify` CLI, upgrade to 0.8.0 or later." Ask the user for the CLI version to name if 0.8.0 isn't released yet; without an answer, leave the version out.
2. **The deletion, as an admin route or a script**, following `registry-backfill.md`'s conventions:
   - A row is Rust-built when its `files` hold a `Cargo.toml` at the entrypoint.
   - A dry run is the default: it lists, per network, the packages, verified accounts, verified notes and stored files it would delete, and deletes nothing.
   - The real run deletes records and files in an order that never leaves a record pointing at a missing file, and is safe to run twice.
   - Test it in a throwaway database with both kinds of rows. Never against production.
3. **Debug package** (decision 5): remove `lib/debug-build.ts`, the `.debug.masp` route, `X-Debug-Commitment`, the debug-build backfill, and stop writing `debug_built_with` and the debug commitment. The columns stay until plan 10.
4. **`schemas`**: stop reading and writing it. The column stays until plan 10.
5. **OpenAPI**: MASM only; republish `apps/api-docs`.
6. **web-viewer**: remove the Rust highlighting, the Rust file rules, `rustType` and the Rust signature writer, and the storage listings.
7. **web-verifier**: remove the Rust rules from `collect-project-files.ts` and any copy that names both kinds.
8. Tests: the 400; the deletion against a throwaway database (dry run, real run, second run); the suites that covered debug packages and package schemas (`debug-packages.test.ts`, `package-schemas.test.ts`) are deleted or reduced.
9. Write the run sheet in the PR description: dry run, what to check in its output, the real run, how to confirm (counts per network), and that there is no undo short of a database restore.

## Before it ships

Walnut's simulator downloads `.debug.masp` and reads `X-Debug-Commitment`. Its team must know the route is going and that the one `.masp` now carries the debug info. Ask the user whether they have been told; this is the user's message to send, not yours.

## Verification

- `pnpm check` passes.
- Rebuilt compose stack with plan 08's api-compile: both suites pass.
- The deletion's dry run and real run in a throwaway database, with the counts in your report.
- Viewer and verifier dev servers against the local registry: a MASM record renders, a Rust upload shows the refusal message.

## STOP conditions

- Any step would touch the production database, bucket or api-compile.
- A verified record points at a package in a way the deletion can't follow (shared packages between a Rust and a MASM record): report the shape.

## Ships with

Plan 08. Order on the day, each on the user's word: deploy registry and api-compile, dry run, real run, check.

## Out of scope

Dropping columns (plan 10), the `miden-verify` CLI (its own repo).
