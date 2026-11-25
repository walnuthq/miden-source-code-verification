# Plan 07: web-viewer shows MASM packages

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Check UI changes against the dev server (`pnpm --filter ./apps/web-viewer dev`). Drift check: `git diff --stat ba261ab..HEAD -- apps/web-viewer`, and confirm plan 05 is merged.

- **Rollout step**: 3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 05
- **Branch**: `feat/web-viewer-masm`

## Goal

A verified MASM package reads well in the viewer: its sources highlighted as MASM, its procedures written as MASM signatures, no storage section. Rust records render as today until plan 09.

## Current state

- `package-sources.server.ts` highlights `.rs` as Rust with Shiki and everything else as TOML.
- `source-files.ts` keeps `Cargo.toml`, `miden-project.toml` and Rust sources in the file list, and finds a package's directory by its `Cargo.toml`.
- `procedure-signatures.ts` writes signatures as Rust (`fn deposit(depositor: AccountId) -> …`, `rustType`).
- Storage listings read the package's `schemas`, which is null for a MASM package (decision 3).
- `plans/013-viewer-page-payload.md` has the constraints on what a page ships.

## Steps

1. A MASM grammar for Shiki. Shiki takes TextMate grammars. The closest thing we own is the Playground's Monarch tokenizer and its vocabulary (`apps/web/lib/masm/language.ts` and `vocabulary.json` in `walnuthq/miden-playground`). Write a TextMate grammar covering comments, doc comments, `proc`/`pub proc`/`begin`/`end`/`use`/`const`, control flow, instructions with their immediates, attributes (`@account_procedure`), numbers, strings and `word("…")`. Keep it in this repo, with a note on where its instruction list came from and how to refresh it.
2. `package-sources.server.ts`: `.masm` → the MASM grammar, `.rs` → Rust, the rest → TOML.
3. `source-files.ts`: keep `miden-project.toml` and `*.masm` for a MASM package; find a package's directory by `miden-project.toml` when there is no `Cargo.toml`. Open the module named by `[lib] path` first.
4. `procedure-signatures.ts`: for a MASM package write `pub proc increment_count(amount: felt)` and `-> felt` for results, with the MASM type names (`felt`, `word`, `u64`, `u16`, `i1`, struct names as declared). A procedure without names shows its types.
5. Storage: no section for a package whose `schemas` is null, rather than an empty one.
6. Copy: re-read the pages for "Rust", "crate", "compiled from".
7. Tests: the grammar on a sample of each construct, the file rules, the signature writer for both kinds.

## Verification

- `pnpm check` passes.
- Dev server against the local registry holding plan 04's fixtures: the MASM counter's page and the note's page, sources tab and procedures, at desktop and phone widths. A Rust record still renders as on `main`.
- The page payload didn't grow beyond the grammar's size: report the number.

## STOP conditions

- Shiki can't load a custom grammar in the way the server module uses it. Report the constraint.

## Out of scope

Removing the Rust rendering (plan 09).
