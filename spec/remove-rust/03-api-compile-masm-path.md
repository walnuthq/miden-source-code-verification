# Plan 03: api-compile builds MASM projects, next to cargo

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply, and its "MASM wire format" section is what you implement. Drift check: `git diff --stat ba261ab..HEAD -- apps/api-compile/src packages/utils/src`, and confirm plan 02 is merged (`miden-assemble` is in the image).

- **Rollout step**: 2
- **Effort**: L
- **Risk**: MEDIUM (touches the production compile route; the Rust path must not change)
- **Depends on**: 02
- **Branch**: `feat/api-compile-masm`

## Goal

`POST /compile` and `POST /verify` accept a MASM project and answer in the wire format the README defines. A project with a `Cargo.toml` at its entrypoint takes the cargo path exactly as today. The Playground, which sends Rust projects, sees no change.

## Current state

- `packages/utils/src/project.ts` is the only reader of `Cargo.toml`: it validates a project (`invalid entrypoint`, `missing Cargo.toml`, `missing miden-project.toml`, …) and derives the package name from `Cargo.toml`'s `[package] name` (ADR 0004).
- `apps/api-compile/src/lib/compile.ts` (681 lines) runs the build around `cargo-miden.ts`: a fresh view of the warm cache, the `builder` user, one build at a time, a retry ladder, the lockfile, the compiler's MASM. Plan 01 removed the debug build and `POST /compile-debug`.
- `packages/utils/src/api-compile.ts` names the wire types (`BuiltPackage`, `CompileResponse`, `VerifyResponse`); the routes build their answers against them with `satisfies`.
- `src/lib/verify.ts` runs `miden-verifier` on the built package.
- ADR 0001: a failed build is a 200. ADR 0006: build isolation, written for builds that run project code.

## Steps

1. `packages/utils/src/project.ts`: a project is Rust when a `Cargo.toml` sits at the entrypoint, MASM otherwise. For a MASM project the name is `miden-project.toml`'s `[package] name`, and the errors are `missing miden-project.toml`, `<path>/miden-project.toml is not valid TOML`, `<path>/miden-project.toml has no [package]`. Keep the Rust branch as it is. Add tests.
2. Add the wire types to `packages/utils/src/api-compile.ts`: `Diagnostic`, `diagnostics` and `builtWith` on the answers, as optional fields so the Rust path still satisfies them.
3. Add `src/lib/assemble.ts`: write the files to a temporary directory, run `miden-assemble` through the helper-tool runner, run `miden-package-metadata --sources`, build the answer, remove the directory. No cache view, no retry, no second build. Keep it apart from `compile.ts`: plan 08 deletes that file's cargo half.
4. Branch in the compile and verify routes on the project kind. For a MASM project, ignore `masm` and `warmLockfile` (`debug` is ignored for every project since plan 01).
5. Limits for the MASM path, in `constants.ts`: a time limit in seconds, not minutes; the existing input size limit; a memory bound if the runner has one. The assembler parses untrusted input but runs none of it, so it needs neither the `builder` user nor the one-build-at-a-time queue: let MASM builds run concurrently, with a small cap.
6. `GET /lockfile` answers 400 for a MASM project, with a message that says a MASM package has no lockfile.
7. Examples: add MASM projects under `apps/api-compile/examples/` next to the Rust ones, in directories that don't collide (`masm/counter-contract`, `masm/counter-note`, `masm/basic-wallet`). The counter pair comes from plan 02's test projects. The Rust examples are the image's warm-up input: don't move them.
8. Tests in `apps/api-compile/__tests__/`: a new `assemble.test.ts` for the MASM path (built answer shape, no `storage`/`noteStorage`/`debug`/`masm` keys, `parameters` with names, `diagnostics` on a failure with project-relative paths, a path dependency, the 400s of step 6, a MASM project with a stray `Cargo.lock` but no `Cargo.toml`). The existing cargo tests stay untouched and green.
9. Docs: `GLOSSARY.md` (Project, Build), `README.md`, the OpenAPI text if api-compile's routes carry any. Add an ADR that supersedes 0006 for MASM builds only: assembling runs no project code, what is kept (time, size, memory), what is not needed.

## Verification

- `pnpm check` passes.
- Rebuilt compose stack: `pnpm --filter ./apps/api-compile test` passes, old and new tests.
- By hand against `localhost:8080`: compile the MASM counter (built, `diagnostics: []`), compile it with a typo (not built, one error with `file`, `line`, `column`), compile the Rust counter example (answer unchanged from `main`: diff the two JSON answers, ignoring timings).
- Measure and report: the MASM compile's wall time, warm.

## STOP conditions

- The Rust path's answer changes in any field.
- The wire format in the README can't be met as written. Propose the change in your report; the Playground's plans read that section.

## Out of scope

The registry (plan 05), fixtures on chain (plan 04), removing anything cargo (plan 08), renaming `cargoMidenVersion`.
