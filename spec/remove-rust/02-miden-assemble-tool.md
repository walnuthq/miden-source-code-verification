# Plan 02: The `miden-assemble` helper tool

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Drift check: `git diff --stat ba261ab..HEAD -- apps/api-compile/crates apps/api-compile/src/lib/helper-tools.ts`, and confirm plan 01 is merged (the crates are on protocol 0.18).

- **Rollout step**: 2
- **Effort**: M
- **Risk**: LOW (a new binary nothing calls yet)
- **Depends on**: 01
- **Branch**: `feat/miden-assemble`

## Goal

A fourth helper tool, `miden-assemble`, in `apps/api-compile/crates/`. Given a project directory and an entrypoint it assembles the `miden-project.toml` project found there into a dev `.masp` and prints one JSON document: either the path of the package it wrote, or the diagnostics. `miden-package-metadata` gains the parameter names of a MASM package. No route calls either yet: plan 03 does.

## Current state

- The spike's tool (`spike/masm-assembly/tool/src/main.rs`, untracked) does the assembly and walks the diagnostics. It is the starting point: move its logic, don't keep the spike crate.
- `miden-package-metadata` prints the manifest, the commitment and three MAST analyses. Its `parameters.rs` reads names from the package's WIT section (`wit-parser`) and its `schemas.rs` reads the storage schemas. A MASM package has neither section.
- `apps/api-compile/src/lib/helper-tools.ts` runs the tools; `__tests__/helper-tools.test.ts` and `fake-tool.ts` test the runner without the binaries.
- ADR 0005 keeps `cargo-miden` off the helper-tool runner. `miden-assemble` is a helper tool and goes through the runner.

## Steps

1. Add the crate `miden-assemble` to the workspace. Command line: `miden-assemble <project-dir> <entrypoint> <out.masp>`.
   - Seed an `InMemoryPackageRegistry` with the core library, the protocol library, the transaction kernel package and the standards library, as the spike does.
   - Assemble the manifest at `<project-dir>/<entrypoint>/miden-project.toml` with the `dev` profile and write the package.
   - Path dependencies must stay inside `<project-dir>`: refuse a manifest whose dependency path leaves it.
2. Output, on stdout, exit code 0 in both cases (a failed build is an answer, as ADR 0001 says for the route):
   - `{ "built": true, "builtWith": "…", "diagnostics": [ … ] }`
   - `{ "built": false, "builtWith": "…", "rendered": "…", "diagnostics": [ … ] }`
   - A diagnostic is `{ severity, message, file?, line?, column?, length?, label?, help? }` as the README's wire format defines it. `file` is relative to `<project-dir>`; `rendered` is the miette report as text with `<project-dir>` cut off.
   - A non-zero exit is for the tool's own failures (unreadable directory, bad arguments).
3. Warnings. Preferred: walk the assembler's warning report and return each warning with its span and `severity: "warning"`, without failing the build. If the report can't be reached from the public API, fall back to a second assembly with `with_warnings_as_errors(true)` whose errors are returned as warnings while the first assembly's package is kept. Say in your report which one you built.
4. Parameter names. In `miden-package-metadata`, when the package has no WIT section, read the names from the source: add an optional `--sources <project-dir>` argument, parse the module named by the manifest's `[lib] path` with the assembler's parser, and pair each exported procedure's declared parameter names with the manifest's types. Keep the existing `parameters` JSON shape. A procedure whose names can't be read gets types without names, not an error.
5. `schemas.rs` stays for now: it must return nothing, without failing, for a package that has no metadata section. Check that it does.
6. Tests in the crates: the three spike projects (move them to `apps/api-compile/crates/miden-assemble/tests/projects/`) build; two builds give the same bytes; a build from a copy in another directory gives the same commitment; a bad instruction gives one error with the right file, line, column and length; a warning case; a dependency path that leaves the project is refused; the parameter names of `increment_count(amount: felt)` come back as `amount`.
7. Add an FPI example (a component that calls `tx::execute_foreign_procedure`) to the test projects and assert `callsForeign` on it: the spike didn't exercise that analysis.
8. Register the tool in `helper-tools.ts` and build it in the Dockerfile's `helpers-builder` stage, copied into `runtime` next to the others.
9. Delete `spike/masm-assembly` once its projects and logic have moved (it is untracked: say so in the report rather than committing a deletion).

## Verification

- `cargo test` in `apps/api-compile/crates` passes, including the new tests.
- `docker compose up -d --build` succeeds and the binary is in the image: run it there on one test project.
- `pnpm check` passes.

## STOP conditions

- The assembler can't be kept from reading outside `<project-dir>` (a manifest that names an absolute path or a workspace root above it).
- The source parser doesn't expose procedure parameter names. Report what it does expose.
- `callsForeign` is wrong on the FPI example: report the MAST shape, don't patch the analysis blind.

## Out of scope

The routes, `compile.ts`, removing `wit-parser` or `schemas.rs` (plan 08).
