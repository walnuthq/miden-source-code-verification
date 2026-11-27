# miden-standards

`asm/` is a verbatim copy of the `asm/` directory of the `miden-standards` crate, at the version in `VERSION`: the one `crates/Cargo.lock` locks. Don't edit it. After a bump of the crate, run `pnpm --filter ./apps/api-compile sync-miden-standards`, which replaces it and regenerates `packages/test-utils/src/standard-fixtures.ts`, then the api-compile suite.

It holds two projects, each built here exactly as upstream builds it:

- `asm/components`, a workspace with one member per account component package. Each member compiles to the package commitment upstream ships.
- `asm/standards`, the standards library. It compiles to the commitment of the library `miden-standards` ships, and holds every standard note script at its note's root: each is one of its procedures marked `@note_script`. No note project of its own can stand in for it: a note script's root depends on what else the forest it is assembled in holds, so 4 of the 19 scripts compile to other roots when assembled alone.

Neither verifies anything: an account of standard components alone and a standard note are never verified.

It sits beside `examples`, not in it: the suites and the status-page probe send all of `examples` with each request.
