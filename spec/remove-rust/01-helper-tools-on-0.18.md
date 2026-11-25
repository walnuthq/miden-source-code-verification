# Plan 01: Helper tools on the 0.18 crates

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Drift check: `git diff --stat ba261ab..HEAD -- apps/api-compile/crates apps/api-compile/Dockerfile`. If the crates changed, re-read "Current state" against the code before going on.

- **Rollout step**: 2
- **Effort**: M
- **Risk**: MEDIUM (the three tools sit on every verify and import in production)
- **Depends on**: none
- **Branch**: `chore/helper-tools-0.18`

## Goal

`miden-import`, `miden-verifier`, `miden-package-metadata` and `generate-fixtures` build against the crates of the 0.18 protocol (the 0.36 VM crates), so they can read a MASM package that carries debug info. Nothing else changes: Rust projects still build with `cargo-miden` 0.11.0 and every existing suite passes.

> Amended on 2026-11-25 while executing: the bumped tools can't read a `cargo-miden` 0.11.0 dev package, so the user chose to retire Rust debug builds in this plan too. See decision 4 in `README.md`.

## Why

A 0.35-based `miden-package-metadata` fails on a dev package built by `miden-assembly` 0.36: `unsupported debug_info version: 4, expected 3`. Plans 02 and 03 keep the dev package (decision 5), so the tools must be bumped first.

## Current state

- `apps/api-compile/crates/` is a Cargo workspace with `miden-import`, `miden-verifier`, `miden-package-metadata`, `generate-fixtures`, a `Cargo.lock` and a `rust-toolchain.toml`.
- The tools are on `miden-client` 0.17.5 and the 0.35 VM crates.
- The Dockerfile builds them in the `helpers-builder` stage and copies the binaries into `runtime`. `cargo-miden` 0.11.0 is installed in its own stage and is not touched here.
- `docs/claude/dependency-bumps.md` and `docs/claude/testing.md` have the rules for bumps and for which network a test may touch.

## Steps

1. Find the `miden-client` release that matches protocol 0.18 on crates.io, and the VM crate versions it pulls in. The spike pinned `miden-protocol` and `miden-standards` `=0.18.0` with `miden-assembly`, `miden-mast-package` and `miden-core-lib` `=0.36.4`.
2. Bump the workspace's dependencies, fix the API changes, and keep each tool's command line and its JSON output unchanged. `apps/api-compile/src/lib/helper-tools.ts` and the registry read that output.
3. Check that a 0.36-based `miden-package-metadata` still reads a package built by `cargo-miden` 0.11.0: run it on a `.masp` built from `apps/api-compile/examples/counter-contract`. Rust projects must keep working until plan 08.
4. Check that it now reads a dev MASM package: build one with the spike tool (`spike/masm-assembly/tool`, `masm-spike <manifest> dev <outdir>`) and run `miden-package-metadata` on it. Compare the JSON with the release package's: same exports, digests, `readOnly`, `accountProcedures`.
5. Rebuild the compose stack and run the api-compile and api-registry suites.
6. Update the version facts in `README.md` and `docs/claude/` where they name 0.17.5 or 0.35.

## Verification

- `cargo test` in `apps/api-compile/crates` passes.
- `pnpm check` passes.
- With the rebuilt stack: `pnpm --filter ./apps/api-compile test` and `pnpm --filter ./apps/api-registry test` pass. They verify against the Rust-built fixtures on Testnet, which is the proof that the bumped `miden-verifier` and `miden-import` still read the chain.
- Steps 3 and 4 give the outputs described.

## STOP conditions

- No `miden-client` release matches protocol 0.18, or it can't read Testnet.
- The bumped `miden-package-metadata` can't read a `cargo-miden` 0.11.0 package. Rust and MASM would then need two builds of the tool: report, don't build that here.
- A tool's JSON output has to change shape.

## Out of scope

`cargo-miden`, the Dockerfile's cargo stages, the MASM build itself, new fixtures.
