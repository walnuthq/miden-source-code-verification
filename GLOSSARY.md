# Miden Source Code Verification

Services that verify that on-chain Miden accounts and notes were built from a given MASM project, and that record and show the result. The registry still holds Rust projects verified before Rust's removal, until they are deleted.

## Language

### On chain

**Network**:
A Miden chain a resource lives on: Testnet (`mtst`), Devnet (`mdev`), Mainnet (`mm`) or a local node (`mlcl`). A root is only meaningful within its network.
_Avoid_: chain, environment

**Resource**:
An on-chain account or note, named by its resource ID.
_Avoid_: entity, target

**Root**:
The on-chain identity of a resource's code: an account's code root or a note's script root. With the network, it is what a verified record is keyed on.
_Avoid_: code (alone), hash

### Verification

**Package**:
The compiled Miden package a project builds to, identified by its commitment. Its bytes are the `.masp` artifact, kept under its commitment and downloaded under the package name as Rust spells the crate (`counter_contract.masp`), `.debug.masp` for its debug build.
_Avoid_: artifact (for the package itself), binary

**Commitment**:
The hash that identifies a package. Two builds with the same commitment are the same package.
_Avoid_: digest (reserved for procedures), hash

**Verified account**:
The record that an account root on a network is made of one or more verified packages, each an account component.

**Verified note**:
The record that a note root on a network is a verified package.

**Verified record**:
A verified account or a verified note: what a lookup by resource id or by root answers.
_Avoid_: entry, row, match

**Source**:
Who a verification says it comes from (`miden-verify`, `web-verifier`, `miden-playground`), as the client states it: nothing authenticates it, and a request without one records `unknown`. The web-verifier sends `web-verifier` unless its `?source=` query param names another. A verified record keeps the source that recorded it. The Miden Playground's records (`miden-playground`) are throwaway deploys: cleanup deletes them after a day, and a verification of the same root from any other source takes one over.
_Avoid_: origin, client

**Build**:
What assembling a project yields: built, with its package and the assembler's report, or failed, with the report alone. A failed build is an outcome, not an error: `POST /compile` answers it with `built: false`.
_Avoid_: compile result, compilation output

**Debug build**:
The dev-profile build of a verified package's sources, kept so a simulator can name call-trace frames. It never decided whether anything is verified. No longer made: the registry serves only the ones it stored before (`<commitment>.debug.masp`). A MASM package carries its debug info in the one package that verifies.
_Avoid_: dev build, debug package

### Sources

**Project**:
A files map plus an entrypoint that builds into one package: a MASM project, with a `miden-project.toml` with a `[package]` at its entrypoint. The package name is that `[package]` name. A `Cargo.toml` at the entrypoint marks a Rust project, which is no longer built; the registry tells the Rust projects it stored before apart by it.
_Avoid_: files map, upload, sources (for the whole)

**Entrypoint**:
The project-relative directory a project is built from, `.` for the root. Files are keyed by paths relative to the project root, never to the entrypoint.
_Avoid_: subdirectory, project dir, package dir

**Workspace root**:
A manifest with no `[package]`, which only lists members. It is not a project; one of its members, named as the entrypoint, may be.
_Avoid_: virtual manifest

### Tooling

**Helper tool**:
One of the four Rust binaries built from `apps/api-compile/crates` that api-compile runs for what Node can't do: `miden-assemble` assembles a MASM project into a package; `miden-import` reads a resource's root, and an account's procedures, from its network; `miden-verifier` checks a package against a resource on chain; `miden-package-metadata` reads a package's commitment and manifest. Each prints its result as JSON when it exits 0 and writes the reason to stderr otherwise; a MASM project that fails to assemble is a result, not a failure. `miden-import` and `miden-verifier` exit with 2 when the request can never succeed and with 1 when a retry may pass.
_Avoid_: binary, CLI, subprocess
