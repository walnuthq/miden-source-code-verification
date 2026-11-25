# Plan 04: MASM fixtures on Testnet

> **Executor**: read `spec/remove-rust/README.md` first; its rules apply. This plan deploys to Testnet: **ask the user for a go-ahead in your session before step 3**, even though this plan describes it. Drift check: `git diff --stat ba261ab..HEAD -- apps/api-compile/crates/generate-fixtures packages/test-utils/src/fixtures.ts`, and confirm plan 03 is merged.

- **Rollout step**: 2
- **Effort**: M
- **Risk**: MEDIUM (outward-facing: creates accounts and notes on Testnet)
- **Depends on**: 03
- **Branch**: `test/masm-fixtures`

## Goal

Close what the spike left open: a MASM-built account and note, deployed on a live network, verify through `miden-verifier`. The deployed resources become test fixtures, added next to the Rust ones, so plan 05's suites have something on chain to verify against.

## Current state

- `apps/api-compile/crates/generate-fixtures` builds the Rust examples with `cargo-miden` (about 20 minutes) and deploys them on Testnet. `packages/test-utils/src/fixtures.ts` holds the resulting ids; every suite and the status probe verify against them.
- `docs/claude/testing.md` says which network a test may touch and how fixtures are regenerated.
- The spike verified offline only: `AccountBuilder` plus `has_procedure` for the account, `NoteScript::from_package(..).root()` for the note.

## Steps

1. Read `docs/claude/testing.md` and `generate-fixtures`' source.
2. Extend `generate-fixtures` with a MASM mode that builds `examples/masm/counter-contract` and `examples/masm/counter-note` with `miden-assemble`'s library code (not through cargo), and deploys one account from the counter component and one note from the counter note. The Rust mode keeps working and its fixtures are not regenerated.
3. After the user's go-ahead: run the MASM mode against Testnet. Record the account id, the note id and the commitments.
4. Add them as new, MASM-named fixtures. Don't rename or remove the Rust ones. Done in a file of their own, `packages/test-utils/src/masm-fixtures.ts` (`pnpm generate-masm-fixtures`), re-exported from the package's index: the Rust mode rewrites all of `fixtures.ts` and would drop them.
5. Add tests to `apps/api-compile/__tests__/verify.test.ts`: `POST /verify` with the MASM counter project answers `verified: true` for the account, the same for the note with its dependency, and `verified: false` for the counter with a changed constant.
6. Run `miden-import` on the new account and note through the import route, and check the answer's shape matches a Rust-deployed resource's.

## Verification

- Rebuilt compose stack: `pnpm --filter ./apps/api-compile test` passes with the new tests.
- `pnpm check` passes.
- Report the ids, the transaction ids of the deploys and the faucet or wallet that funded them.

## STOP conditions

- The user doesn't give the go-ahead: stop after step 2, with the MASM mode built and untested against the chain.
- `miden-verifier` answers `verified: false` for the unchanged MASM project. This is the result the whole rollout rests on: report the roots on chain against the package's exports, and change nothing else.
- The deploy needs funds the fixtures wallet doesn't have.

## Out of scope

Regenerating or removing the Rust fixtures (plan 08), the registry.
