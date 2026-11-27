# Plan 10: Cleanup

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Read `docs/claude/database-migrations.md`: a dropped column ships with its migration and only after a release that no longer reads it. Drift check: confirm plans 08 and 09 are merged and deployed, and that the Rust deletion has run.

- **Status**: done (2026-11-27), in two releases: #160, then #161 with the column drop.
- **Rollout step**: 7
- **Effort**: S
- **Risk**: LOW, except the column drops (MEDIUM)
- **Depends on**: 09, deployed
- **Branch**: `chore/remove-rust-cleanup`

## Goal

No document, comment, column or workflow in this repo still describes Rust projects.

## Steps

1. Columns, as their own migration: drop `schemas`, `debug_built_with` and the debug commitment column from `packages`, after checking that no deployed code reads them. Rename nothing.
2. `README.md`, `GLOSSARY.md` (Project, Build, Debug build, Helper tool, Package), `CODING_STANDARDS.md`, `MIGRATION.md`, `CLAUDE.md`, and `docs/claude/` (`deploys.md`, `local-development.md`, `testing.md`, `dependency-bumps.md`): rewrite what names cargo, lockfiles, the warm cache or debug builds.
3. Mark as historical, with one line at the top saying why: `spec/masp-reproducibility.md` and its patch, `spec/procedure-parameters.md`, `spec/upstream-miden-issues.md`, and the plans in `plans/` that concern the cargo build (004, 005, 010, 016, 020, 021, 025). Update `plans/README.md`'s status rows. Plan 025 (more than one toolchain) is worth a note rather than a tombstone: an assembler per protocol version is a few megabytes, so the feature became cheap.
4. `spec/account-procedures.md` and `spec/foreign-calls.md`: the analyses survive; fix what they say about how packages are built.
5. `grep -ri "rust\|cargo\|midenc\|wit\b" --include=*.ts --include=*.tsx --include=*.md .` outside `apps/api-compile/crates` and `node_modules`: every hit is either about the helper tools' own language or gets fixed.
6. Update the status of this folder's README.

## Verification

- `pnpm check` passes; the migration applies on a copy of the schema and `drizzle-kit` reports no drift.
- Rebuilt compose stack: both suites pass.

## STOP conditions

- A deployed service still reads a column you are about to drop.

## Out of scope

Anything in the Playground or the CLI repos.
