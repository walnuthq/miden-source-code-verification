# MASP reproducibility across build machines

Compiling the same sources produces a different `.masp` locally than in
production, even though both builds have the same package commitment. This
document explains where the difference comes from, whether it matters for the
registry, and how to make the files identical.

## Observation

After the MASP artifacts moved to object storage, the two account components of
the testnet fixture `COUNTER_CONTRACT_ID_1` (`0x858c680a7a66d2916230cc8c2a6c98`)
and the note script of `COUNTER_NOTE_ID_1` (`0x5a1fdb87…87a2`) were verified
through the production web-verifier, and their files were downloaded from the
production registry. They were compared with builds of the same sources
(`apps/api-compile/examples/counter-contract/`) from the local docker-compose
api-compile.

| Package                  | Commitment    | Size      | Bytes that differ       |
| ------------------------ | ------------- | --------- | ----------------------- |
| `counter-contract`       | `0xd4ae…2b9d` | 14,976 B  | 32, offsets 14324–14355 |
| `auth-component-no-auth` | `0xb869…bdf3` | 8,058 B   | 32, offsets 7598–7629   |
| `counter-note`           | `0x8163…e670` | 422,203 B | 64, offsets 4545–4608   |

The sizes and commitments match. In each account component, the only
difference is one run of 32 consecutive bytes. In the note, it's one run of 64.

Two more checks narrowed it down:

- **Builds on the same machine are identical.** Two consecutive `/compile`
  calls against the local api-compile returned byte-identical files, even though
  api-compile builds every request in a fresh `mkdtemp` directory
  (`apps/api-compile/src/lib/compile.ts`).
- **Same code, same toolchain.** The local image was rebuilt from the commit
  production runs, and both pin the same toolchain (`nightly-2026-09-01` in
  `apps/api-compile/Dockerfile` and the examples' `rust-toolchain.toml`).
  `cargo-miden` is pinned to 0.11.0 in both.

## Root cause

### The differing bytes are hashes in the provenance section

Each file holds a `project_source_provenance` section. In the account
components, the 32 differing bytes sit right after the section's name, at the
position of the provenance record's `source_hash`. The rest of the record (the
dependency hash and the build settings) is identical, and so is every other
section, the MAST forest included. The note's 64 differing bytes are both
hashes of its record, `source_hash` and `dependency_hash`. See
[Dependencies propagate the difference](#dependencies-propagate-the-difference).

The section is written by `miden-assembly`
(`src/project/build_provenance.rs`, 0.35). It's `PackageBuildProvenance::Path`:

- `source_hash`: a hash of the target's build projection plus its root and
  support source files.
- `dependency_hash`: a hash of the resolved dependency closure.
- `build_settings`: the profile settings that affect the package bytes.

Its purpose is build caching. `ProjectAssembler` compares it with the provenance
the current sources would produce, to decide whether a package already in a
package store can be reused or has to be rebuilt. It doesn't describe the
package's code.

### What `source_hash` covers for a Rust package

`compute_path_source_hash_from_sources` (`miden-assembly`,
`src/project/dependency_graph.rs`) hashes:

1. `Package::build_provenance_projection` (`miden-project`): the package name
   and version, the target and the profile. No paths.
2. For each source file, a label, `root:<path>` or `support:<path>`, and the
   file's content. The path is relative to the project root when the file is
   under it, and absolute otherwise.

For a Rust project, midenc's frontend (`midenc-compile` 0.11,
`pipeline/frontends/rust.rs` and `wasm.rs`) reports a single root source: the
`.wasm` cargo produced. The hashed content is that module printed as WAT
(`WasmProvenance { path, wat }`). So `source_hash` depends on:

- every byte of the compiled `.wasm`, custom sections included (producers,
  names), since they all appear in the WAT;
- the path of the `.wasm` file.

### Dependencies propagate the difference

The record is serialized as a tag byte (`4` for `Path` with build settings),
then `source_hash`, then `dependency_hash`, then two booleans for the build
settings. In the files above:

| Package                  | Dependencies           | `source_hash` | `dependency_hash` |
| ------------------------ | ---------------------- | ------------- | ----------------- |
| `counter-contract`       | none built from source | differs       | identical         |
| `auth-component-no-auth` | none built from source | differs       | identical         |
| `counter-note`           | `counter-contract`     | differs       | differs           |

`dependency_hash` comes from `compute_dependency_closure_hash` (`miden-assembly`,
`src/project/dependency_graph.rs`). For each dependency it hashes a line built
by `dependency_resolution_hash_input`:

- a registry or preassembled dependency contributes its name and selected
  version, which don't depend on the host;
- a path dependency built from source, like `counter-contract` for the note,
  contributes `source:<id>:<provenance.describe()>`. That description embeds
  the dependency's own `source_hash`, which comes from its `.wasm`.

So any host difference in a dependency's `.wasm` changes the `dependency_hash`
of every package above it, transitively. Here, the note's `dependency_hash`
differs because `counter-contract`'s `source_hash` differs, as the first row
shows.

The note file holds a second `project_source_provenance` section, near the
end of the file. It's identical on both machines.

### Why local and production disagree

Neither the random build directory nor the code version explains it: builds on
one machine are identical, and both images run the same code. What differs is
the host:

|              | Local (docker-compose, OrbStack)         | Production (Cloudflare Containers) |
| ------------ | ---------------------------------------- | ---------------------------------- |
| Architecture | `linux/arm64`                            | `linux/amd64`                      |
| Image        | built from `apps/api-compile/Dockerfile` | same Dockerfile                    |
| Toolchain    | `nightly-2026-09-01`                     | `nightly-2026-09-01`               |

The host architecture is the cause. rustc, running on different host
architectures, emits `.wasm` files that differ in ways that don't reach the
lowered MAST. That leaves the commitment identical and the WAT, and so
`source_hash`, different.

### Confirmation (2026-11-12)

The three packages were built on both architectures on one machine, from the
same Dockerfile (cut after the warm-up builds), with the build api-compile
runs: a copy of the example in a temp directory, the shared
`CARGO_TARGET_DIR`, `cargo miden build --release`. The table gives the number
of bytes that differ from the production file:

| Build                                        | `counter-contract` | `auth-component-no-auth` | `counter-note` |
| -------------------------------------------- | ------------------ | ------------------------ | -------------- |
| amd64, examples as of 2026-10-09 (`0c0f3ee`) | 0                  | 0                        | 0              |
| arm64, examples as of 2026-10-09             | 32                 | 32                       | 64             |
| amd64, current examples (`0809fd1`)          | 32                 | 32                       | 64             |
| arm64, current examples                      | 31                 | 32                       | 64             |

The differing bytes are the hash fields described above (the 31 is one byte
that happens to coincide). Sizes and commitments are the same in every build.

- **An amd64 build reproduces production byte for byte**, and an arm64 build
  of the same sources doesn't.
- **The lockfile is a second input.** The production files were recorded
  before the examples' lockfiles were updated (`078588e`, 2026-11-01). That
  update alone changes `source_hash` on either architecture, with the
  commitment unchanged. A local amd64 build of the current examples therefore
  doesn't match the stored files either.
- **The project directory is not an input.** Building in another temp
  directory gave identical files on both architectures. Cargo's target
  directory is one: see the end of this section.

In every pair (amd64 against arm64, old lockfile against new), the two `.wasm`
files have the same size and differ by 11 to 33 bytes. All of them are crate
hashes inside mangled symbol names, for example
`_RNvNtCshbBG9ViipQ1_16counter_contract…` against
`_RNvNtCs7UdU5TbqH4g_16counter_contract…`, for the package's own crate and for
its dependencies (`miden_base`, `miden_field`).

**Every differing byte is in the `name` custom section** of the component's
core module. Parsing the sections of each pair shows no difference anywhere
else, and the files are equal once that one section is left out. The section
only holds debug names: it doesn't affect what the module does.

**Cargo's `-C metadata` is where the host gets in.** A crate's hash in a
symbol name comes from the `-C metadata` value cargo passes to rustc. Cargo
computes it in `compute_metadata` (`src/compiler/build_runner/compilation_files.rs`,
read at `e8cb624d5`, the cargo that `nightly-2026-09-01` ships). Two of its
inputs matter here:

- the `-C metadata` values of the crate's dependencies, build scripts and
  proc macros included;
- on a nightly toolchain, the host triple, for crates built for the host only
  (`hash_rustc_version`). A crate built for Wasm doesn't hash it directly.

So the host reaches a Wasm crate only through the crates built for the host
below it, in two ways. Both were checked with a wrapper (`RUSTC`) that runs
the real compiler, can rewrite the `host:` line of `rustc -vV`, and logs the
arguments of every rustc invocation (about 340 per build).

**1. The host triple, through any build script or proc macro.**

- On arm64, reporting `aarch64-unknown-linux-musl` instead of
  `aarch64-unknown-linux-gnu` changes all three crate hashes in the `.wasm`,
  and `source_hash` with them.
- On arm64, reporting `s390x-unknown-linux-gnu` changes the `-C metadata` of
  17 of the 18 crates built for Wasm, the standard library's `alloc`
  included. Only `core`, which has no build script or proc macro below it,
  keeps its value.

**2. The host's dependency graph, through the SDK's proc macro.** With both
architectures reporting the same host (`s390x-unknown-linux-gnu`), the
`.wasm` files still differ, in the hash of the package's own crate only:
those of `miden_base` and `miden_field` now agree. In the logs, 214 of the
277 crates built on both architectures get the same `-C metadata` and 63
don't. Of the 18 built for Wasm, four differ: `miden` and the three packages.
Following the differences down from each package gives the same chain:

```
counter_contract, auth_component_no_auth, counter_note (wasm)
└─ miden (wasm)
   └─ miden_base_macros (proc macro, built for the host)
      └─ … miden_assembly_syntax, miden_core, miden_debug_types …
         └─ miden_crypto (host)
            ├─ blake3, chacha20, poly1305 (host)
            │  └─ cpufeatures (host): depends on libc on aarch64 only
            └─ curve25519_dalek (host): depends on cpufeatures, and on
               curve25519_dalek_derive on x86_64 only
```

`cpufeatures` is the one differing crate with no differing dependency: it's
where the two builds first diverge. Its dependencies are conditional on the
architecture it's built for, and it's built for the host because the SDK's
proc macro (`miden_base_macros`) links the Miden VM crates. Its value
differs, so does the proc macro's, then `miden`'s, then each package's.

A note on the method: `blake3`'s build script trusts the reported host, so on
amd64 the wrapper passed that crate's x86 `--cfg` flags itself. Cargo doesn't
see arguments the wrapper adds, so they can't have changed a `-C metadata`
value. On arm64, a build through the wrapper reporting the real host gives
the same files as a build without it.

**Cargo's target directory is a third input, on the same machine.** Building
on arm64 with another `CARGO_TARGET_DIR` gives byte-identical `.wasm` files
and a different `source_hash`: the `.wasm` is hashed under its absolute path
(see [What `source_hash` covers](#what-source_hash-covers-for-a-rust-package)).
Changing `MIDENC_TARGET_DIR` alone changes nothing. api-compile always builds
in `/cache/target`, which is why its builds agree with each other.

### Debug builds: the same cause reaches the code

`docs/claude/debug-builds.md` records that a debug build's commitment differs
between x86_64 and aarch64. It's the same cause with a larger effect. In the
dev profile, the debug `.wasm` files of `counter-contract` and `counter-note`
differ across architectures in their `code` and `data` sections too (same
sizes, other content), and their custom sections come in another order: the
crate hashes are part of the symbol names the functions are ordered by. The
MAST differs, and so does the commitment. `auth-component-no-auth`, whose
`code` section is the same on both, keeps its commitment.

| Debug package            | Commitment, amd64 | Commitment, arm64 |
| ------------------------ | ----------------- | ----------------- |
| `counter-contract`       | `0xdd3b…6e2d`     | `0x4527…52ed`     |
| `auth-component-no-auth` | `0x4f35…0bc9`     | `0x4f35…0bc9`     |
| `counter-note`           | `0x5f65…3710`     | `0xf0d7…8b9a`     |

A fix limited to the provenance section can't help here: the `.wasm` itself
has to come out the same.

### A package also holds paths from the machine that built the compiler

Found on the way: the `counter-note` package holds 21 absolute paths of the
form `/usr/local/cargo/registry/src/index.crates.io-…/miden-protocol-0.17.1/asm/…`.
They are source locations of the protocol library linked into `cargo-miden`,
as they were on the machine that compiled `cargo-miden`. A `cargo-miden` built
from the `v0.11.0` tag with its lockfile links `miden-protocol` 0.17.0, and
the paths in its packages say so, while `cargo install cargo-miden --version
0.11.0` resolved 0.17.1. The commitment is the same either way. So the bytes
of a package also depend on where, and with which dependency versions, the
compiler was installed.

## Upstream state (2026-11-12)

Filed as [0xMiden/compiler#1505](https://github.com/0xMiden/compiler/issues/1505)
on 2026-11-12, for the release and the dev profile together, with an offer to
open the pull requests. What was found before filing:

- **No existing report.** Neither `0xMiden/miden-vm` nor `0xMiden/compiler`
  has an issue or pull request about this (searched for provenance,
  `source_hash`, `dependency_hash`, reproducible, deterministic,
  byte-for-byte, name section, aarch64/arm64). The nearest is miden-vm #2945,
  closed by #3091, which narrowed build provenance to "fields that can affect
  the selected target's artifact": the principle this report relies on.
- **The code is unchanged on both default branches** (`next`: miden-vm
  `e7295a986`, compiler `f662b93a0`). `build_provenance.rs` and
  `dependency_graph.rs` are identical to `miden-assembly` 0.35.0. The
  compiler's Wasm frontend was reworked after v0.11.0, but `WasmProvenance`
  still takes the WAT of the whole module and the path it was read from
  (`midenc-compile/src/pipeline/frontends/wasm.rs`).
- **The fix belongs in `0xMiden/compiler`.** It supplies both the content and
  the path that `miden-assembly` hashes, and it runs cargo. It already builds
  with `trim-paths` and `--remap-path-prefix` (`frontends/rust.rs`), so
  independence from the build machine is something it aims for.
- **It reproduces with the compiler's own examples** (`examples/` at
  `v0.11.0`, default target directory). The release commitments are equal and
  the dev ones differ, for `counter-contract` and `counter-note`. The release
  files differ by 54 and 86 bytes: the provenance hashes, plus two 11-byte
  crate hashes in mangled names that those packages store next to their
  procedure paths. Our examples' release packages hold no such names, and why
  wasn't established.
- v0.11.0 is the compiler's latest release. miden-vm has released 0.36.4 and
  1.0.0-rc.0 since the 0.35.0 tested here.

## Impact

This doesn't affect correctness:

- **Identity.** Packages are keyed by `dependency_commitment()` (see #48). It
  covers the code, name, version, kind, manifest and component metadata, but
  not the provenance section. Both builds have the same commitment, and the
  registry stores the file as `<commitment>.masp`.
- **Verification.** api-compile's `/verify` compares on-chain code roots
  with the compiled package's MAST. The provenance section isn't involved.
- **Stable downloads.** The registry writes a package's file only when it first
  inserts the package, so a commitment always serves the same bytes: those of
  whichever build recorded it first.

It does limit consumers in two ways:

- **No checksum check.** Downloading a package and comparing a SHA-256 with a
  local build fails across machines. The only reliable check is to deserialize
  the package and recompute its commitment.
- **Not reproducible.** The same sources don't give a byte-for-byte identical
  artifact, which weakens the "anyone can rebuild and compare" story the
  project borrows from Sourcify.

## Fix options

### 1. Strip the provenance section in api-compile (recommended)

Before api-compile returns `masp`, deserialize the package, remove the
`SectionId::PROJECT_SOURCE_PROVENANCE` section, and serialize it again.
`miden-package-metadata` (`apps/api-compile/crates/miden-package-metadata`)
already deserializes the package to read its commitment and manifest, so it
can also write out the stripped package, and `compile.ts` would read that file
instead.

- **Identical bytes.** In all three packages here, the provenance hashes were
  the only difference, so the files would come out the same on any machine.
  Dropping the whole section also removes the `dependency_hash` that carries a
  dependency's difference into its dependents.
- **Commitment unchanged.** `dependency_commitment()` doesn't cover the
  section, so it stays the same.
- **Verification unchanged.** `/verify` doesn't read the section.
- **Cost:** someone who imports a registry `.masp` into their own package store
  loses the cache-reuse hint. Their assembler treats it as a package without
  provenance and rebuilds from source instead of reusing it. Registry consumers
  don't use the section.
- **Caveat:** this only holds while the provenance hashes are the only thing
  that varies between machines. Three packages is a small sample, and a future
  compiler that writes host-specific data into the code itself would change the
  commitment too. That would be a bigger problem, which this fix wouldn't hide.

Once deployed, files already in R2 keep their provenance section, because the
registry writes a file only on first insert. Either re-verify the affected
packages after clearing them, or run a one-off job that rewrites the stored
files.

To lock in the guarantee, add a test to api-compile's suite: compile the same
example twice, from two different `CARGO_TARGET_DIR`s, and require identical
`masp` bytes. If production can be targeted, also compare with the committed
fixtures.

### 2. Fix it in the compiler (long term)

Two fixes were tested on both architectures, with the three packages of the
counter example. The files are in `spec/masp-reproducibility/`.

**A. Give Wasm crates a `-C metadata` that doesn't depend on the host**
(`rustc-stable-metadata.sh`). A rustc wrapper replaces cargo's value, for
crates built for Wasm only, with a hash of the crate's name and version.
The compiler runs cargo, so it could install such a wrapper itself
(`RUSTC_WRAPPER`).

- amd64 and arm64 then produce byte-identical `.wasm` and `.masp` files, in
  the release and the dev profile. This is the only fix that covers debug
  builds.
- Release commitments are unchanged (`0xd4ae…2b9d`, `0xb869…bdf3`,
  `0x8163…e670`). Debug commitments change once, to the value both
  architectures then agree on.
- It doesn't remove the target directory from `source_hash`: the test built in
  the same directory on both machines.
- Open points: the name and version don't tell apart two builds of one crate
  with other features, which a real implementation has to handle, and build
  scripts and proc macros keep cargo's value, as they should.

**B. Hash a host-independent view of the module**
(`provenance-fix-v0.11.0.patch`, about 70 added lines in
`midenc-compile/src/pipeline/frontends/wasm.rs`). `WasmProvenance` takes the
WAT of the module without its `name` sections, and the file name instead of
the full path.

- Release packages are then byte-identical across amd64 and arm64, across two
  `CARGO_TARGET_DIR`s, and across the lockfile update of 2026-11-01.
- Commitments are unchanged.
- It leaves the `.wasm` as it is, so it does nothing for debug builds, nor
  for a release package that stores mangled names, like those of the
  compiler's own examples.
- The `name` section is the only thing left out: the other custom sections
  hold data the frontend reads (`rodata,miden_account`, `rodata,miden_wit`).

A and B are complementary: A makes the compiled module the same everywhere,
B keeps the provenance hash from depending on things that aren't part of what
was built. A alone would still need the path part of B.

### 3. Build on one architecture everywhere (doesn't fix the root cause)

Run local api-compile as `linux/amd64` (`platform: linux/amd64` in
docker-compose), so local builds match production. Useful for checking
fixtures, but it doesn't help anyone verifying from another machine, and
emulation makes local builds slower.

## Recommendation

1. ~~Confirm the architecture cause with a local `linux/amd64` build.~~ Done,
   see [Confirmation](#confirmation-2026-11-12).
2. Strip the provenance section in api-compile, add the reproducibility test,
   and rewrite or re-record the packages already in R2.
3. ~~Open an issue on `0xMiden/compiler` with the reproduction, the cause and
   the two tested fixes.~~ Done:
   [0xMiden/compiler#1505](https://github.com/0xMiden/compiler/issues/1505).
   Remove the stripping once a compiler release fixes it.
