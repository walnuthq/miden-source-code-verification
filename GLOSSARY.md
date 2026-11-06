# Miden Source Code Verification

Services that verify that on-chain Miden accounts and notes were compiled from a given Rust source project, and that record and show the result.

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
The compiled Miden package a project builds to, identified by its commitment. Its bytes are the `.masp` artifact.
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

**Debug build**:
The dev-profile build of a verified package's sources, kept so a simulator can name call-trace frames. It never decides whether anything is verified.
_Avoid_: dev build, debug package

### Sources

**Project**:
A files map plus an entrypoint that cargo-miden can build into one package: at the entrypoint sit a `Cargo.toml` with a `[package]` and a `miden-project.toml`. The package name is the `[package]` name.
_Avoid_: files map, upload, sources (for the whole)

**Entrypoint**:
The project-relative directory a project is built from, `.` for the root. Files are keyed by paths relative to the project root, never to the entrypoint.
_Avoid_: subdirectory, project dir, package dir

**Workspace root**:
A `Cargo.toml` with no `[package]`, which only lists members. It is not a project; one of its members, named as the entrypoint, may be.
_Avoid_: virtual manifest
