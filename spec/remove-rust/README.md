# Remove Rust: sub plans for this repo

Written 2026-11-25 at `ba261ab`. Nothing here is implemented.

The Miden Rust compiler (`cargo-miden`, `midenc`) is being phased out. Accounts, notes and transaction scripts are written in plain MASM again, as `miden-project.toml` projects that `miden-assembly` builds into `.masp` packages. This repo must stop building, storing and showing Rust projects, and do the same job for MASM projects.

The full analysis, the decisions and the spike results are in the Playground repo: `spec/remove-rust.md` in `walnuthq/miden-playground` (on this machine `../miden-playground/spec/remove-rust.md`). Everything a plan needs from it is repeated below or in the plan, so a session that can't read the other repo still works.

Each plan is written for one agent in one session and ends in one PR. Start a session with: "Read `spec/remove-rust/README.md`, then carry out `spec/remove-rust/NN-….md`."

## The plans

| Plan                                                                    | Rollout step | Depends on                | Needs a go-ahead from the user         |
| ----------------------------------------------------------------------- | ------------ | ------------------------- | -------------------------------------- |
| [01 Helper tools on the 0.18 crates](01-helper-tools-on-0.18.md)        | 2            | none                      | no                                     |
| [02 The `miden-assemble` helper tool](02-miden-assemble-tool.md)        | 2            | 01                        | no                                     |
| [03 api-compile builds MASM projects](03-api-compile-masm-path.md)      | 2            | 02                        | no                                     |
| [04 MASM fixtures on Testnet](04-testnet-masm-fixtures.md)              | 2            | 03                        | yes: Testnet deploys                   |
| [05 The registry accepts MASM](05-registry-accepts-masm.md)             | 3            | 03, 04                    | no                                     |
| [06 web-verifier uploads MASM](06-web-verifier-masm.md)                 | 3            | 05                        | no                                     |
| [07 web-viewer shows MASM](07-web-viewer-masm.md)                       | 3            | 05                        | no                                     |
| [08 api-compile drops cargo](08-api-compile-drops-cargo.md)             | 6            | Playground plans 01 to 07 | no                                     |
| [09 Registry and viewer drop Rust](09-registry-and-viewer-drop-rust.md) | 6            | 08                        | yes: deletes production rows and files |
| [10 Cleanup](10-cleanup.md)                                             | 7            | 09                        | no                                     |

Order across repos: plans 01 to 07 here, deployed; then the Playground's plans 01 to 05 (its switch to MASM) and 06 to 07 (its content); then 08 to 10 here; then the Playground's cleanup and the `miden-verify` CLI (`spec/remove-rust.md` in that repo).

Plans 06 and 07 touch different apps and can run at the same time, in separate checkouts. Every other plan runs after the ones it depends on are merged.

## Rules for every plan

- Read `CLAUDE.md`, and the `docs/claude/` guide for the area you touch, before changing anything. Follow `CODING_STANDARDS.md` and use `GLOSSARY.md`'s words.
- Work on a new branch off an updated `main`, in the main checkout. No worktree unless the user asks.
- Commit on that branch. Push, open a PR or merge only when the user's prompt says so: a merge deploys to production. No Claude attribution in commits or PRs.
- Run the plan's drift check first. On a mismatch you can't explain, stop and report.
- Never read the `.env` files (`cat`, `grep`, `source`). Never send requests to the production api-compile during a rollout.
- Deploying to Testnet, regenerating fixtures, and anything that deletes rows or files need the user's go-ahead in that session, even where the plan describes the step.
- The api-compile and api-registry suites test what listens on `localhost:8080` and `8081`, normally the docker compose stack: rebuild it (`docker compose up -d --build`) before testing a server change.
- Kill processes by PID, never with a `pkill -f` pattern.
- `pnpm check` (lint, typecheck, server-free tests) passes before you report. Run `pnpm exec biome check --write` on Markdown you edit.
- When a STOP condition occurs, stop and report. Don't improvise around it.
- End with a report: what changed, what you verified and how, what you didn't verify, and anything the next plan should know. Update this README's table if a plan's shape changed.

## Decisions that bind this repo

Taken by the user on 2026-11-24 and 2026-11-25. The numbers are those of the Playground spec.

1. The helper tools stay Rust programs. The MASM project assembler is a fourth helper tool.
2. No schemas. A MASM package has no storage schema and no note storage schema, and none is planned upstream (an assumption). api-compile stops returning `storage` and `noteStorage`; the registry stops writing its `schemas` column and drops it later; the viewer's storage listings go.
3. Parameter names come from the MASM source's AST. The package manifest has the types only.
4. One package with debug info. A dev and a release assembly share procedure roots, MAST forest commitment and `dependency_commitment` (the commitment api-compile reports). The verified package is the dev one. `POST /compile-debug`, `debugCommitment`, `debugBuiltWith` and the `.debug.masp` route go when cargo goes. Walnut's simulator reads debug builds from the registry: its team is told before that ships.
   - Changed on 2026-11-25, in plan 01: the 0.36 helper tools can't read a `cargo-miden` 0.11.0 dev package (`unsupported debug_info version: 3, expected 4`), so the user chose to stop making Rust debug builds then. `POST /compile-debug`, the `debug` request flag and answer key, `DebugBuild`, `CompileDebugResponse` and the registry's debug-build backfill are gone; no new row gets a debug build. The `.debug.masp` route, `X-Debug-Commitment`, `debugPackage` and the columns still serve the debug builds stored before, until plans 09 and 10.
5. Rust-built packages and their verified records are deleted when cargo leaves api-compile, on Mainnet too. No discriminator column. It is a destructive production step, run once on an explicit go-ahead.
6. A Playground script is one MASM file plus a generated `miden-project.toml`. Projects uploaded to the verifier can have more modules and path dependencies.
7. Both paths live in api-compile until the Playground has switched: a project with a `Cargo.toml` at its entrypoint is a Rust project, any other is a MASM project. Cargo is removed last.

The `miden-verify` CLI is updated after plan 09. Until then the released CLI uploads Rust projects, and it prints the registry's answer, so plan 09's refusal message matters.

## What the spike established

Run on 2026-11-24. Its code was in `spike/masm-assembly` (untracked, removed by plan 02): its assembly and diagnostics logic is now `apps/api-compile/crates/miden-assemble`, and its projects (a counter account component, a note that calls it and a transaction script that calls it) are that crate's `tests/projects`.

- `miden-assembly` 0.36.4 builds a project with `Assembler::for_project_at_path(manifest, registry).assemble(ProjectTargetSelector::Library, profile)`. The registry is an `InMemoryPackageRegistry` seeded with the core library, the protocol library, the transaction kernel package and the standards library. Crate pins that worked: `miden-assembly`, `miden-mast-package`, `miden-package-registry`, `miden-core-lib` at `=0.36.4`; `miden-protocol`, `miden-standards` at `=0.18.0`.
- A build takes 15 to 18 ms, is reproducible and doesn't depend on the directory it runs in.
- `for_project_at_path` reads from disk: write the files to a temporary directory, as api-compile does today.
- Diagnostics are miette reports. The `Diagnostic` labels can be walked in code, which gave `counter_account.masm:25:13+4` and the label text. Paths are absolute: cut the project directory off.
- One error per build is the norm: later phases don't run after a failed one.
- By default warnings print only `one or more warnings were emitted`. `with_warnings_as_errors(true)` returns them as errors with spans.
- The manifest's signatures carry types, no parameter names. `AccountId` and `Asset` are structs with a bare name; `word` is `Array(Felt, 4)`; `u64`, `u16`, `i1` are primitives.
- The manifest JSON printed by `miden-package-metadata` has the same shape as for a Rust package, and the `readOnly` and `accountProcedures` analyses work unchanged. `callsForeign` was not exercised by the spike; plan 02's `fpi-account` test project shows it right on a MASM package.
- `miden-verifier`'s checks pass offline on MASM packages: an account built from the counter package has every export's digest, and `NoteScript::from_package(note).root()` equals the note export's digest. No deploy on a live network was done.
- The `miden-protocol` and `miden-standards` 0.18.0 crates ship packages versioned 0.17.2, and `miden-core-lib` 0.36.4 ships 0.36.3: a project's dependency version names the package, not the crate. `"*"` resolves.
- The helper tools in this repo are on `miden-client` 0.17.5 and the 0.35 VM crates. A 0.35-based `miden-package-metadata` reads a 0.36 release package and fails on a dev one: `unsupported debug_info version: 4, expected 3`.
- MASM types: `word` and `i1`, not `Word` and `bool`. `AccountBuilder::with_auth_component` doesn't exist in protocol 0.18: use `.with_component(NoAuth)`.

## The MASM wire format

Plan 03 implements it and the Playground's plans read it. Change it only by changing this section in the same PR.

A project is a files map plus an entrypoint. It is a Rust project when a `Cargo.toml` sits at the entrypoint, and a MASM project otherwise; a MASM project needs a `miden-project.toml` there.

`POST /compile` for a MASM project answers the existing `CompileResponse` with these differences:

- `masp` is the dev package, with debug info. There is no second build: `debug`, `masm` and `warmLockfile` in the request are accepted and ignored, and the answer has no `debug` and no `masm` key.
- No `storage` and no `noteStorage` key.
- `parameters` holds the names read from the source.
- `files` is the project as sent. There is no lockfile to add.
- `diagnostics` is new, on both outcomes: a list of `{ severity: "error" | "warning", message, file?, line?, column?, length?, label?, help? }`. `file` is relative to the project root, `line` and `column` start at 1, `length` is in characters. A failed build has at least one error.
- `stderr` holds the same diagnostics as the assembler renders them, with the project directory cut off, for clients that show text. `stdout` is empty.
- `builtWith` is new: the versions the tool was built with, as one string (for example `miden-assembly 0.36.4, miden-protocol 0.18.0`). `cargoMidenVersion` is absent.

`POST /verify` for a MASM project answers the existing `VerifyResponse` with the same differences. A project that doesn't build is a `400` as for a Rust one, with `error` holding the rendered report (what `stderr` holds for `/compile`) and no `diagnostics`.
