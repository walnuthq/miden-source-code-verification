# Plan 08: api-compile drops cargo

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. Read `docs/claude/deploys.md`, `testing.md`, `warm-lockfile.md` and `debug-builds.md`: this plan deletes most of what the last two describe. Drift check: confirm plans 01 to 07 are merged, and ask the user to confirm that the Playground has switched to MASM in production (its plans 01 to 07): until then it sends Rust projects and this plan breaks it.

- **Rollout step**: 6
- **Effort**: L
- **Risk**: HIGH (removes the Rust build from production; not reversible without a revert and a 30-minute image build)
- **Depends on**: Playground plans 01 to 07, deployed
- **Branch**: `feat/api-compile-drops-cargo`

## Goal

api-compile builds MASM projects only. The Rust toolchain, `cargo-miden`, the warm cache, the build isolation, the lockfile route, the debug build and the compiler-MASM output are gone from the code, the image and the tests. The image shrinks from 3.33 GB (1.5 to 1.6 GB of it warm cache).

## Current state

After plan 03 the MASM path lives in `src/lib/assemble.ts` and the cargo path in `src/lib/compile.ts` (681 lines), `cargo-miden.ts` (220 lines), `preload.ts`, `build-output.ts`, `scripts/lay-out-warm-cache.sh`, `scripts/preload-first-build.sh`, `routes/lockfile.ts`. Plan 01 already removed `routes/compile-debug.ts` and the debug build. The Dockerfile (229 lines) has a `cargo-miden-builder` stage and copies rustup and cargo into `runtime`. `__tests__/` has `compile.test.ts` (790 lines), `preload`, `lockfile`, `build-output` for the cargo path. `examples/` holds three Rust projects (84 files) that are also the image's warm-up input.

## Steps

1. A project with a `Cargo.toml` at its entrypoint is refused with a 400: "Rust projects are no longer supported: Miden projects are written in MASM (`miden-project.toml`)". `packages/utils/src/project.ts` loses its `Cargo.toml` reading, the `masm` option of `openProject` (plan 03) and `Project.kind`; the package name comes from `miden-project.toml` only. Update ADR 0004's text: same conclusion, another file.
2. Delete the cargo path: `cargo-miden.ts`, the cargo half of `compile.ts`, `preload.ts`, `build-output.ts`, both scripts, `routes/lockfile.ts`, `BUILD_USER`, `COMPILE_CONCURRENCY = 1`, the retry ladder, `warmLockfile` and `masm` request flags, `MasmOutput`, `MAX_MASM_BYTES`. The Dockerfile's dev-profile warm-up build (`cargo miden build --locked` without `--release`) has had no use since plan 01.
3. Wire types (`packages/utils/src/api-compile.ts`): remove `storage`, `noteStorage`, `masm`; `cargoMidenVersion` goes, `builtWith` becomes required; `diagnostics` becomes required. Update the README's wire format section in the same PR.
4. Crates: `miden-package-metadata` loses `schemas.rs`, the WIT half of `parameters.rs`, and the `wit-parser` and `miden-note-schema` dependencies. `miden-verifier` keeps its export filter; remove the comment about compiler internals (`cabi_realloc`, `init`, adapters).
5. Dockerfile: remove the `cargo-miden-builder` stage, the rustup and cargo copies, the warm-up build and `/cache/image`. The `rust` stage stays as a build stage for the helper tools. The runtime is Node plus four binaries.
6. Timeouts and queue in `constants.ts` come down to seconds. The Cloudflare Worker's compile timeout (`apps/api-compile-cloudflare`, 420 s) and the registry's follow. Revisit the container's instance type (`standard-2` was chosen for the cache and cargo) and say what you measured.
7. Examples: delete the Rust projects; move `examples/masm/*` up to `examples/`.
8. Tests: delete the cargo suites, keep `import`, `limiter`, `helper-tools`, `errors`, `verify` and the MASM suite. Add the 400 of step 1.
9. Fixtures: `generate-fixtures` loses its cargo mode; the Rust fixtures leave `packages/test-utils/src/fixtures.ts` and the MASM ones take their names. Nothing is deployed: plan 04's resources are reused.
10. `apps/status-page`: the probe compiles and verifies the MASM fixture, and its copy stops saying Rust.
11. `.github/workflows/deploy-api-compile-cloudflare.yml`: drop the image-cache warm-up that exists for the 30-minute cold build, if nothing else needs it.
12. Supersede ADR 0005 and ADR 0006; delete `docs/claude/warm-lockfile.md` and `debug-builds.md`, and their rows and the lockfile rule in `CLAUDE.md`.

## Verification

- `pnpm check` passes; `cargo test` in the crates passes.
- Rebuilt compose stack: api-compile and api-registry suites pass.
- Report: image size before and after, cold start of the container (50 s today), warm compile time.
- `grep -ri "cargo\|rustup\|lockfile" apps/api-compile/src` finds nothing but the helper tools' build.

## STOP conditions

- The user hasn't confirmed the Playground's switch is live.
- The registry suite fails for a reason other than the removed lockfile route: plan 09 owns the registry's side, but the two ship together, so report what the registry needs.

## Ships with

Plan 09. The registry reads `storage` and `noteStorage` today: merge and deploy the two together, registry first if its changes tolerate both shapes.

## Out of scope

Deleting Rust records (plan 09), dropping database columns (plan 10).
