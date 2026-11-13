# Upstream Miden gaps found while integrating

An audit of the workarounds this repository carries because of its Miden
dependencies, written so each finding can be filed as an upstream issue.

- **Scope:** the Miden crates used by `apps/api-compile/crates`
  (`miden-import`, `miden-verifier`, `miden-package-metadata`,
  `generate-fixtures`), and the code elsewhere in the repo that exists because
  of them. Compiler and faucet findings that surfaced on the way are listed
  separately in [Adjacent findings](#adjacent-findings).
- **Versions audited (2026-11-11, `e00b93d`):** `miden-client` and
  `miden-client-sqlite-store` 0.17.5, `miden-standards` and `miden-protocol`
  0.17.1, `miden-mast-package`, `miden-assembly-syntax`, `miden-core`,
  `miden-core-lib` and `miden-serde-utils` 0.35.0, `midenc-hir-type` 0.17.0.
- **Method:** every crate source file was read, the rest of the repo was
  searched for notes pointing upstream, and each claim was checked against the
  crate sources in `~/.cargo/registry`. Nothing was checked against the
  upstream `main` branches or issue trackers, so search for duplicates and
  re-check against the latest release before filing. The upstream repository
  names below are the expected homes of each crate and need confirming.

## Summary

| #   | Upstream crate                         | Finding                                                               | Kind        | Cost to us                                  |
| --- | -------------------------------------- | --------------------------------------------------------------------- | ----------- | ------------------------------------------- |
| C1  | `miden-client`                         | A missing or private note is reported only by message string          | Gap         | String matching in two tools                |
| C2  | `miden-client`                         | Reading one public account or note needs a full client and a store    | Improvement | A SQLite store per network on the server    |
| C3  | `miden-client`                         | A store used against a second network fails without saying why        | Problem     | One store directory per network             |
| C4  | `miden-client-sqlite-store`            | A store from an older schema is refused, with no migration            | Problem     | Stores must be deleted by hand              |
| C5  | `miden-client`, `miden-protocol`       | No `NetworkId` to `Endpoint` mapping, no public `mlcl` constant       | Improvement | The same string match in three tools        |
| C6  | `miden-client`                         | Waiting for a transaction exists only behind the `testing` feature    | Improvement | Two hand-written polling loops              |
| C7  | `miden-client`                         | A custom script and own output notes can't be combined                | Blocker     | Fixture deploys redesigned around it        |
| C8  | `miden-client`                         | `CallConv` and the signature types aren't re-exported                 | Improvement | An extra exact pin kept in step by hand     |
| C9  | `miden-client`                         | `InputNoteRecord` converts to `Note` through `TryInto`, not `TryFrom` | Nit         | Awkward call site                           |
| S1  | `miden-standards`                      | Standard component detection doesn't say which procedures it claimed  | Gap         | Detection re-implemented in `miden-import`  |
| S2  | `miden-standards`                      | The schema commitment component isn't a standard component            | Gap         | Appended by hand to the detection list      |
| S3  | `miden-standards`                      | Component variants have no stable identifier                          | Improvement | A hand-written name table per variant       |
| S4  | `miden-standards`                      | `AccountInterface::new` panics instead of returning an error          | Improvement | Constructor avoided                         |
| S5  | `miden-protocol`                       | No way to ask which package exports become account procedures         | Gap         | Filtering exports by calling convention     |
| S6  | `miden-protocol`                       | Protocol procedures don't say whether they change state               | Gap         | A hand-kept list of 126 procedure names     |
| S7  | `miden-protocol`                       | No way to build `InitStorageData` from a schema's defaults            | Improvement | The CLI's schema walk copied                |
| V1  | `miden-mast-package` and its types     | The manifest types no longer derive `serde`                           | Gap         | 250 lines of hand-written JSON              |
| V2  | `miden-assembly`, `miden-mast-package` | `.masp` bytes and `commitment()` depend on the build host             | Problem     | No byte-for-byte reproducibility            |
| V3  | `miden-mast-package`, `miden-protocol` | Serialized packages and accounts are readable by one version only     | Problem     | Fixtures regenerated on every format change |

Kinds: a **blocker** forced a different design, a **problem** is behaviour we
think is wrong, a **gap** is something missing that we rebuilt, an
**improvement** would have saved work, a **nit** is cosmetic.

## miden-client

Expected repository: `0xMiden/miden-client`.

### C1. A missing or private note is reported only by message string

- **Where:** `import_error` in `miden-import/src/main.rs:58` and
  `miden-verifier/src/main.rs:82`.
- **What we do:** match `ClientError::NoteImportError(message)` against the
  literals `"No notes fetched from node"` and
  `"Incomplete imported note is private"` to tell "this note will never
  import" (exit code 2, a 4xx for the caller) from a transient failure (exit
  code 1, a 502).
- **Upstream cause:** `import_notes` builds both errors as
  `NoteImportError(String)` (`src/note/import.rs:200` and `:225`). The account
  side has typed variants (`AccountNotFoundOnChain`, `AccountIsPrivate`), and a
  `NoteNotFoundOnChain` variant exists but this path doesn't use it.
- **Risk:** a reworded message silently turns "not found" into a retryable
  502. Our tests fake the tools, so they wouldn't catch it.
- **Ask:** return `NoteNotFoundOnChain(note_id)` when the node answers with no
  notes, and add a typed variant for a private note (for example
  `NoteIsPrivate(note_id)`).

### C2. Reading one public account or note needs a full client and a store

- **Where:** `run` in both `miden-import` and `miden-verifier`;
  `apps/api-compile/src/lib/helper-tools.ts:108`;
  `MIDEN_CLIENT_CACHE_DIR` in `apps/api-compile/src/lib/constants.ts`.
- **What we do:** to read an account's code or a note's script once, each tool
  builds a `Client` with a SQLite store and a filesystem keystore, calls
  `import_account_by_id` or `import_notes`, then reads the record back from the
  store with `get_account` or `get_input_note`. The server therefore keeps a
  writable cache directory, runs the tools with it as working directory, and
  inherits the store's failure modes (C3, C4).
- **Upstream cause:** the documented way to fetch a resource is the import
  path, which writes to the store, and `ClientBuilder` requires a store
  (`src/builder.rs:508`). `NodeRpcClient` does expose `get_account_details` and
  `get_note_by_id`, but nothing documents them as a supported stateless path,
  and we haven't tried them.
- **Ask:** a documented read-only way to fetch a public account or note by ID
  with no store, either as helpers on `GrpcClient` returning `Account` and
  `Note`, or as an in-memory store available outside the `testing` feature.
- **Our side:** we could try the RPC methods directly before upstream answers.
  That would remove C3 and C4 for these two tools.

### C3. A store used against a second network fails without saying why

- **Where:** the per-network `network_dir` in both tools (commit `a8a3bd3`).
- **What we do:** keep one store and keystore per network
  (`<cache>/mtst/`, `<cache>/mdev/`, `<cache>/mm/`).
- **Upstream cause:** the builder reads the genesis header from the store and
  sets it as the RPC client's genesis commitment (`src/builder.rs:525`), which
  is then sent with every request. A store first synced with testnet gets
  every devnet request rejected by the node. Nothing ties the store to a
  network, so the failure appears as a node-side rejection.
- **Ask:** record the network (or genesis commitment) in the store and fail
  `ClientBuilder::build` with a typed error that names both networks when the
  endpoint doesn't match.

### C4. A store from an older schema is refused, with no migration

- **Where:** `docs/claude/local-development.md` (the `MIDEN_CLIENT_CACHE_DIR`
  note).
- **What happens:** after a `miden-client` bump, an existing store fails with
  `stored schema at version 1 does not match the schema this client builds for
that version` (`miden-client-sqlite-store`, `src/db_management/errors.rs:18`).
  The only fix is deleting the store. In production the container's cache is
  rebuilt with the image, so this bites on the host and would bite any
  long-lived deployment.
- **Ask:** migrate the store forward, or make the error say that the store has
  to be recreated and offer a call that does it.

### C5. No `NetworkId` to `Endpoint` mapping, no public `mlcl` constant

- **Where:** the `match args_network_id.as_str()` in `miden-import` and
  `miden-verifier`; `endpoint` and `LOCALHOST_NETWORK_ID` in
  `generate-fixtures/src/main.rs:58`.
- **What we do:** map `"mtst"`, `"mdev"`, `"mm"` and `"mlcl"` to
  `Endpoint::testnet()` and the others by hand, three times.
- **Upstream cause:** `Endpoint::to_network_id` exists
  (`src/rpc/endpoint.rs:69`) but the reverse doesn't. `NetworkId` has no
  variant for a local node; `"mlcl"` appears only as a literal inside
  `to_network_id`.
- **Ask:** `Endpoint::try_from(&NetworkId)` (or `Endpoint::for_network`), and a
  public constant or `NetworkId` constructor for the local network.

### C6. Waiting for a transaction exists only behind the `testing` feature

- **Where:** `wait_for_commitment` in `generate-fixtures/src/account.rs:252`
  and `wait_for_note` in `generate-fixtures/src/fee.rs:324`.
- **What we do:** poll `sync_state` and `get_transactions` until the
  transaction is committed or discarded, with our own timeout. A second loop
  does the same for a note the client expects to receive.
- **Upstream cause:** `wait_for_tx` and `wait_for_consumable_notes` exist in
  `src/test_utils/common.rs`, compiled only with `testing`, with no timeout
  parameter.
- **Ask:** public `Client` methods that wait for a transaction to commit and
  for a note to arrive, taking a timeout and returning a typed
  discarded/timed-out error. Every deploy script needs them.

### C7. A custom script and own output notes can't be combined

- **Where:** `deploy_counter_contract` and `deploy_bank` in
  `generate-fixtures/src/account.rs`; `fee.rs` module docs; the `Packages`
  doc in `build.rs`.
- **Upstream cause:** `TransactionRequestBuilder::build` returns
  `"Cannot set both a custom script and own output notes"`
  (`src/transaction/request/builder.rs:765`). On a fee-charging chain an
  account whose auth component can't create the `TX_FEE` note has to create it
  through `own_output_notes`, which takes the script slot.
- **What it forced:**
  - the counter contracts no longer deploy through
    `examples/counter-contract/counter-script`; the increment moved into a
    note, and the example script is shipped but used by no fixture;
  - the bank accounts use the standard `NoAuth` instead of the example auth
    component, so `init-tx-script` can keep the script slot;
  - every transacting fixture account carries the standard `BasicWallet`,
    because the derived send-notes script only exists for the standard wallet
    procedure roots.
- **Ask:** let a request carry both, by composing the send-notes script with
  the custom script, or give the builder a way to pay the fee that doesn't use
  the script slot (for example `.fee_note(note)`).

### C8. `CallConv` and the signature types aren't re-exported

- **Where:** `miden-verifier/Cargo.toml` (`miden-assembly-syntax = "=0.35.0"`,
  "which `miden-client` does not re-export").
- **Upstream cause:** `miden_client::vm` re-exports `Package`,
  `PackageExport` and `ProcedureExport`, whose `signature` field is a
  `FunctionType`, but of `miden_assembly_syntax::ast::types` it re-exports only
  the `signatures` submodule (`src/lib.rs:314`). Reading
  `signature.abi == CallConv::ComponentModel` needs a direct dependency pinned
  to exactly the version the client resolves.
- **Ask:** re-export `ast::types` (at least `FunctionType`, `CallConv` and
  `Type`) next to the package types.

### C9. `InputNoteRecord` converts to `Note` through `TryInto`

- **Where:** `generate-fixtures/src/fee.rs:370`
  (`TryInto::<Note>::try_into(record)`).
- **Upstream cause:** `impl TryInto<Note> for InputNoteRecord`
  (`src/store/note_record/input_note_record/mod.rs:443`) rather than
  `impl TryFrom<InputNoteRecord> for Note`, so `Note::try_from(record)` doesn't
  compile.
- **Ask:** implement `TryFrom`.

## miden-standards and miden-protocol

Expected repository: `0xMiden/protocol` (formerly `miden-base`).

### S1. Standard component detection doesn't say which procedures it claimed

- **Where:** `standard_account_components` in `miden-import/src/main.rs:128`.
- **What we do:** re-implement
  `StandardAccountComponent::extract_standard_components` so the import answer
  can list, for each detected standard component, the procedure roots it
  accounts for. The registry needs that to tell which of an account's
  procedures are standard and which a verified package must cover. The list
  and its order are copied, and the order matters: `NoteCreator`'s only
  procedure is also one of `BasicWallet`'s.
- **Upstream cause:** the public call returns bare
  `AccountComponentInterface` variants, and the per-component step
  (`extract_component`, `src/account/components/mod.rs:71`) is private. There
  is no way to iterate the components in detection order.
- **Cost so far:** the copy has to be updated on each release that adds a
  component (commit `2e0eeee`, "add new variants for standard account
  components"). A component missing from the copy shows as unverified code.
- **Ask:** a public function that returns each detected component with the
  roots it claimed, or `StandardAccountComponent::all()` in detection order.

### S2. The schema commitment component isn't a standard component

- **Where:** the `SchemaCommitment` entry chained onto the list in
  `miden-import/src/main.rs:162`.
- **Upstream cause:** `AccountBuilderSchemaCommitmentExt::
build_with_schema_commitment` is what the CLI and the client's own examples
  build accounts with, and it adds `AccountSchemaCommitment`
  (`get_schema_commitment`). That component has no `StandardAccountComponent`
  or `AccountComponentInterface` variant, so its procedure falls into
  `Custom`.
- **Effect:** every account built the default way has one procedure no
  standard component and no user package accounts for, and can never be shown
  as fully verified without the special case.
- **Ask:** add the variant to both enums and to
  `extract_standard_components`.

### S3. Component variants have no stable identifier

- **Where:** the `match component { … => "BasicWallet", … }` in
  `miden-verifier/src/main.rs:149` and the name table in `miden-import`.
- **Upstream cause:** `AccountComponentInterface::name()` returns display
  strings (`"Basic Wallet"`, `"Role Based Access Control"`), and drops the
  `Auth` prefix on some variants (`"SingleSig"`, `"Multisig"`).
  `StandardAccountComponent` has no name at all. `StandardNote::name()` is
  the kind of identifier we'd want here.
- **What we do:** keep our own variant-to-identifier table. The identifiers are
  stored in the registry and shown by the viewer, so they're part of our API.
- **Ask:** a stable `as_str()` on both enums that returns the variant
  identifier, kept separate from the display name.

### S4. `AccountInterface::new` panics instead of returning an error

- **Where:** the comment above `AccountComponentInterface::from_procedures` in
  `miden-verifier/src/main.rs:137`.
- **Upstream cause:** `AccountInterface::new` (and so `from_account` and
  `from_code`) asserts that exactly one auth component is present
  (`src/account/interface/mod.rs:38`). The verifier runs on accounts read from
  a public network or deserialized from request bytes, where a panic becomes a
  502.
- **Status:** 0.17.1 counts `CustomAuth` as an auth component, so the
  assertion holds for the accounts we verify. We still avoid the constructor,
  because it panics on input it considers malformed.
- **Ask:** a fallible constructor (`AccountInterface::try_from_account`), for
  tools that inspect accounts they didn't build.

### S5. No way to ask which package exports become account procedures

- **Where:** `verify_account_component` and `verify_note_script` in
  `miden-verifier/src/main.rs`.
- **What we do:** keep only the exports whose signature has
  `CallConv::ComponentModel`, and treat those as the procedures an account
  installs (or as a note's entrypoint). Everything else a Rust-compiled package
  exports is toolchain plumbing: the Wasm-ABI adapter around each procedure,
  `cabi_realloc`, `init`.
- **Upstream cause:** this rule is not written down in any API. The only call
  that yields a component's procedures is `AccountComponent::from_package`,
  which needs `InitStorageData` the verifier doesn't have.
- **Risk:** this is the core check of the verification service, and it rests
  on a convention we inferred.
- **Ask:** a storage-free call that returns the account procedure roots a
  package would install (for example on `AccountComponentCode`), and a
  documented statement of which exports those are.
- **Our side:** for notes, `NoteScript::from_package(&package)?.root()` already
  exists (`miden-protocol`, `src/note/script.rs:108`) and could replace our
  filter.

### S6. Protocol procedures don't say whether they change state

- **Where:** `miden-package-metadata/src/read_only.rs`.
- **What we do:** to tell users which exported procedures are read-only, walk
  each export's MAST down to the `miden::protocol` procedures and classify
  those from two hand-kept lists, 19 state-changing and 107 read-only names.
  Two tests fail when a protocol release adds or removes a procedure.
- **Upstream cause:** every protocol procedure reaches the kernel through one
  dispatcher (`syscall.exec_kernel_proc` with an offset), so the MAST can't
  tell `get_item` from `set_item`, and the library's manifest carries no
  attribute that does.
- **Ask:** mark the protocol library's procedures as mutating or read-only,
  ideally as an attribute in the package manifest (`ProcedureExport` already
  has an `AttributeSet`), or publish the table from `miden-protocol`.
- **Related:** `ProtocolLib` and `StandardsLib` expose `package()`,
  `mast_forest()` and `AsRef<Package>`, while `CoreLibrary` exposes
  `mast_forest()` only. A common accessor would simplify `Analyzer::default`.

### S7. No way to build `InitStorageData` from a schema's defaults

- **Where:** `init_storage_data` in `generate-fixtures/src/account.rs:44`.
- **What we do:** walk `AccountComponentMetadata::schema_requirements()` the
  way `miden-client-cli`'s `new-account` command does, taking schema defaults
  where they exist and zero otherwise. A zero has to be written two ways:
  `"0"` parses only as a felt, so a word-typed slot needs
  `WordValue::FullyTyped(Word::default())`.
- **Ask:** `InitStorageData::from_defaults(&metadata)` with optional
  overrides, so tools that instantiate a compiled component don't copy the
  CLI.

## miden-vm crates

Expected repository: `0xMiden/miden-vm` (`miden-mast-package`,
`miden-assembly`, `miden-assembly-syntax`) and `0xMiden/compiler`
(`midenc-hir-type`).

### V1. The manifest types no longer derive `serde`

- **Where:** `miden-package-metadata/src/main.rs` (all of it below `main`) and
  its TypeScript mirror `packages/utils/src/manifest.ts`.
- **Upstream cause:** up to `miden-mast-package` 0.29 the package manifest
  serialized with `serde`. In 0.35 the crate still has a `serde` feature, but
  only `PackageId` and `TargetType` implement it. `PackageExport`,
  `ProcedureExport`, `Dependency`, and the `miden-assembly-syntax` and
  `midenc-hir-type` types they contain (`FunctionType`, `Type`,
  `AttributeSet`, `ConstantValue`) don't. `midenc-hir-type`'s own `serde`
  feature is binary serialization through `miden-serde-utils`.
- **What we do:** write the JSON by hand, in the shape the derives used to
  produce, and unfold the recursive types `midenc-hir-type` 0.17 introduced
  (`RecTypeRef`) ourselves. Both files have to be re-checked on every bump of
  four crates.
- **Ask:** bring the manifest and its types back under the `serde` feature, or
  provide another stable, documented text form of a package's interface. Block
  explorers, registries and IDE tooling all need to show it.

### V2. `.masp` bytes and `commitment()` depend on the build host

- **Where:** `spec/masp-reproducibility.md` (full analysis); the `commitment`
  comment in `miden-package-metadata/src/main.rs:45`; migration
  `20261007104015_rename_digest_to_commitment`.
- **What happens:** the same sources, toolchain and Docker image produce
  `.masp` files that differ between an arm64 and an amd64 host, by the 32-byte
  `source_hash` (and, for a package with a path dependency, `dependency_hash`)
  in the `project_source_provenance` section. `miden-assembly` computes
  `source_hash` over the WAT of the compiled `.wasm` and its path
  (`src/project/build_provenance.rs`, `src/project/dependency_graph.rs`).
- **What we do:** identify packages by `dependency_commitment()`, which
  leaves the section out, instead of `commitment()`. The stored files still
  differ: a consumer can't compare a download with a local build by checksum.
  Stripping the section before storing is specified but not implemented.
- **Confirmed (2026-11-12):** an amd64 build on the same machine reproduces
  the production files byte for byte, and an arm64 build of the same sources
  doesn't. The two `.wasm` files differ only in crate hashes inside mangled
  symbol names, all of them in the core module's `name` custom section. A
  dependency update (`cargo update`) changes the hash the same way, with the
  commitment unchanged. The crate hashes depend on the host through cargo's
  `-C metadata`, which covers each crate's build scripts and proc macros:
  those hash the host triple, and the SDK's proc macro has dependencies that
  differ by architecture (`cpufeatures`, `curve25519-dalek`). Separately, the
  `.wasm` is hashed under its absolute path, so another `CARGO_TARGET_DIR`
  on the same machine changes `source_hash` too.
- **Filed (2026-11-12):**
  [0xMiden/compiler#1505](https://github.com/0xMiden/compiler/issues/1505),
  together with A3. There was no existing report, and the code is unchanged
  on the default branches of both repositories. The fix belongs in
  `0xMiden/compiler`. Two fixes were tested on both architectures: a
  host-independent `-C metadata` for Wasm crates, which also fixes debug
  builds (A3), and a small patch to the provenance inputs, which fixes
  release packages only.
- **Ask:** make the provenance hashes independent of the host (hash a
  normalized module, label sources relative to the target directory), and
  document which of `commitment()`, `dependency_commitment()` and
  `mast_forest_commitment()` external tools should use as a package's
  identity.

### V3. Serialized packages and accounts are readable by one version only

- **Where:** `docs/claude/testing.md` (regenerate fixtures when the format
  changes) and `docs/claude/local-development.md` (stale helper binaries).
- **Upstream cause:** `Package::read_from_bytes` accepts exactly one format
  version (`unsupported version. Got '[7, 0, 0]', but only … is supported`,
  `miden-mast-package`, `src/package/serialization/mod.rs:208`). Account
  serialization behaved the same way across an earlier upgrade
  (`Unsupported version. Got '[0, 0, 3]'`).
- **Effect on us:** each format bump invalidates the committed fixture blobs,
  which costs a testnet redeploy of about 20 minutes, and makes the `.masp`
  files the registry already stores unreadable by the current tools. For a
  registry meant to keep verified artifacts for the life of a contract, that's
  the larger concern.
- **Ask:** read at least the previous format version, or ship a conversion
  tool, and state the compatibility policy for `.masp` files.

## Adjacent findings

These came up in the same code but belong to the compiler, SDK or faucet rather
than to the crates in scope.

| #   | Upstream                 | Finding                                                                                                                                                                                                                                                                                                                                                                                  | Where                                                      |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A1  | Compiler / Rust SDK      | A Rust-compiled auth component has no ready way to pay the transaction fee, so only accounts with a standard auth component can transact without help. `miden-base-sys` 0.15 binds `tx::compute_fee` and `tx::get_fee_asset_id` but not `miden::standards::fee`. Ask: an SDK helper and an example auth component that creates the `TX_FEE` note. Not yet tried: see #126 before filing. | `generate-fixtures/src/fee.rs`, `note.rs`                  |
| A2  | Compiler (`midenc` 0.11) | Dev builds fail with `failed to legalize operation 'cf.switch'` when an inlined function can end three ways (here, a `vec!` allocation inside `withdraw`). Release builds are unaffected. We changed the example's source to avoid the allocation.                                                                                                                                       | `examples/miden-bank/bank-account/src/lib.rs:303`          |
| A3  | Compiler                 | A debug build's commitment differs between x86_64 and aarch64 hosts; the release commitment doesn't. Debug packages can't be checked against an expected commitment. Same cause as V2 (see `spec/masp-reproducibility.md`), filed with it as 0xMiden/compiler#1505.                                                                                                                      | `docs/claude/debug-builds.md`                              |
| A4  | `cargo-miden`            | A nested `cargo miden build` inherits `RUSTUP_TOOLCHAIN` and `CARGO_TARGET_DIR` from a parent cargo, which overrides the project's `rust-toolchain.toml` and moves the `generated-wit/` directory dependents resolve against.                                                                                                                                                            | `generate-fixtures/src/build.rs:30`                        |
| A5  | Faucet                   | `miden-faucet-lib` pins its own `miden-client`, so using its request types would duplicate the client in our lockfile. We call the two HTTP endpoints and solve the proof of work by hand. Taken from our manifest comment, not re-checked. Ask: a types-only client crate.                                                                                                              | `generate-fixtures/Cargo.toml`, `fee.rs` (`mint`, `solve`) |
| A6  | Faucet (0.17)            | `/get_tokens` answers with a note ID before the note is on chain and offers no way to ask about its progress. We poll for up to 10 minutes and can't tell a slow funding service from a stalled chain.                                                                                                                                                                                   | `generate-fixtures/src/fee.rs` (`wait_for_note`)           |

## Corrections made on our side

The check against the 0.17.1 and 0.17.5 sources showed four places where our
crates no longer matched upstream. They weren't upstream issues, and were
fixed in
[#127](https://github.com/walnuthq/miden-source-code-verification/pull/127):

1. `miden-verifier` said `AccountInterface::from_account` panics for every
   account with a Rust-compiled auth component. In 0.17.1 `CustomAuth` counts
   as the auth component, so it doesn't. The comment now gives the reason that
   still holds: the constructor panics on input it considers malformed (S4).
2. `generate-fixtures` said the client requires an authenticator. It's
   optional in 0.17.5; the comment says so.
3. `generate-fixtures` said the SDK has no binding for the kernel's fee
   procedures. `miden-base-sys` 0.15 binds the pieces `pay_fee` is made of, so
   the comments now say that no example auth component pays its fee yet.
   Whether one can is tracked in
   [#126](https://github.com/walnuthq/miden-source-code-verification/issues/126).
   Hold A1 and C7 until that issue has an answer: a "yes" turns C7 from a
   blocker into an improvement we no longer depend on.
4. All three `miden-client` consumers enabled the `testing` feature without
   using it. It's removed, and the workspace builds without it.

## Suggested filing order

1. **C7, S2, S1:** they shape the verification result or forced a design
   change, and each has a small, concrete ask.
2. **V1, S6, S5:** the largest amounts of code we maintain in place of an
   upstream API.
3. **V3:** it needs a policy decision upstream (format compatibility), so
   start the discussion early. V2 and A3 are filed (0xMiden/compiler#1505).
4. **C1, C3, C4:** error-reporting fixes that are cheap upstream.
5. The rest, as time allows.
