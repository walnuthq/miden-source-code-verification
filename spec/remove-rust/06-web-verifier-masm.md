# Plan 06: web-verifier uploads MASM projects

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Check UI changes against the dev server (`pnpm --filter ./apps/web-verifier dev`), not a rebuilt image. Drift check: `git diff --stat ba261ab..HEAD -- apps/web-verifier`, and confirm plan 05 is merged.

- **Rollout step**: 3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 05
- **Branch**: `feat/web-verifier-masm`

## Goal

The verifier's form takes a folder holding a MASM project and uploads it. Rust folders keep working until plan 09.

## Current state

- `apps/web-verifier/src/lib/collect-project-files.ts` is a port of the `miden-verify` CLI's file filter. It keeps `src/**`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `rust-toolchain.toml`, `.cargo/config.toml`, and finds the packages of a folder by their `Cargo.toml`.
- The form's copy says "Select the folder of the Rust project to verify".
- `plans/014-verifier-directory-import.md` describes how the directory import was built.

## Steps

1. Collector: also keep `miden-project.toml` (already kept if listed; check) and every `*.masm` file wherever it sits, since a manifest's `[lib] path` can point anywhere. Find packages by `miden-project.toml`; a package is Rust when a `Cargo.toml` sits next to it. Keep skipping `target/` and hidden directories.
2. For a MASM package, upload only `miden-project.toml` and `*.masm` files. For a Rust package, upload what is uploaded today.
3. The entrypoint picker lists packages of both kinds.
4. Copy: "Select the folder of the Miden project to verify". Re-read every string in the app for "Rust", "Cargo" and "crate".
5. Tests for the collector: a single MASM package, a MASM package with its sources outside `src/`, a note with a path dependency, a mixed folder, a Rust package unchanged.

## Verification

- `pnpm check` passes.
- Dev server against the local registry: verify the MASM counter fixture (plan 04) from its example folder, and the note with `--entrypoint`-style selection of `counter-note`. Verify a Rust example still works.
- Check the page at a phone width if the form's layout changed.

## STOP conditions

- The registry refuses the uploaded MASM project: report the request body's file list and the answer.

## Out of scope

Removing the Rust rules (plan 09). The `miden-verify` CLI has its own plan in its repo and must end up with the same filter: note in your report the exact rules you shipped.
