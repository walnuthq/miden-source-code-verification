# MASP reproducibility across build machines

Compiling the same sources produces a different `.masp` locally than in
production, even though both builds have the same package commitment. This
document explains where the difference comes from, whether it matters for the
registry, and how to make the files identical.

## Observation

After the MASP artifacts moved to object storage, the two account components of
the testnet fixture `COUNTER_CONTRACT_ID_1` (`0x858c680a7a66d2916230cc8c2a6c98`)
were verified through the production web-verifier, and their files were
downloaded from the production registry. They were compared with builds of the
same sources (`apps/api-compile/examples/counter-contract/`) from the local
docker-compose api-compile.

| Package                  | Commitment    | Size     | Bytes that differ       |
| ------------------------ | ------------- | -------- | ----------------------- |
| `counter-contract`       | `0xd4ae…2b9d` | 14,976 B | 32, offsets 14324–14355 |
| `auth-component-no-auth` | `0xb869…bdf3` | 8,058 B  | 32, offsets 7598–7629   |

The sizes and commitments match. In each file, the only difference is one run
of 32 consecutive bytes.

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

### The 32 bytes are one hash in the provenance section

Each file holds a `project_source_provenance` section, followed by
`account_component_metadata`. The 32 differing bytes sit right after the
section's name, at the position of the provenance record's `source_hash`. The
rest of the record (the dependency hash and the build settings) is identical,
and so is every other section, the MAST forest included.

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

### Why local and production disagree

Neither the random build directory nor the code version explains it: builds on
one machine are identical, and both images run the same code. What's left
is the host:

| | Local (docker-compose, OrbStack) | Production (Cloudflare Containers) |
| --- | --- | --- |
| Architecture | `linux/arm64` | `linux/amd64` |
| Image | built from `apps/api-compile/Dockerfile` | same Dockerfile |
| Toolchain | `nightly-2026-09-01` | `nightly-2026-09-01` |

The most likely cause is that rustc and LLVM, running on different host
architectures, emit `.wasm` files that differ in ways that don't reach the
lowered MAST. That would leave the commitment identical and the WAT, and so
`source_hash`, different.

**This hasn't been confirmed.** To confirm it, build the api-compile image for
`linux/amd64` locally (`docker build --platform linux/amd64 …`), compile the
same example, and compare with the production file. If they match, the
architecture is the cause. If they don't, compare the two `.wasm` files to find
which other input varies.

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

- **Identical bytes.** In both packages here, the provenance hash was the only
  difference, so the files would come out the same on any machine.
- **Commitment unchanged.** `dependency_commitment()` doesn't cover the
  section, so it stays the same.
- **Verification unchanged.** `/verify` doesn't read the section.
- **Cost:** someone who imports a registry `.masp` into their own package store
  loses the cache-reuse hint. Their assembler treats it as a package without
  provenance and rebuilds from source instead of reusing it. Registry consumers
  don't use the section.
- **Caveat:** this only holds while the provenance hash is the only thing that
  varies between machines. Two packages is a small sample, and a future
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

Ask the Miden compiler team to make the provenance hash independent of the
host. For example:

- hash a normalized `.wasm`, without its custom sections, or the lowered HIR
  instead of the raw WAT;
- label the root source relative to the target directory instead of by
  absolute path;
- build Rust with `-Z trim-paths` / `--remap-path-prefix` so the `.wasm` holds
  no host paths.

This keeps the section's purpose (cache reuse) and makes rebuilds
reproducible. It's out of this project's control, so open an issue on the
compiler with the reproduction above.

### 3. Build on one architecture everywhere (doesn't fix the root cause)

Run local api-compile as `linux/amd64` (`platform: linux/amd64` in
docker-compose), so local builds match production. Useful for checking
fixtures, but it doesn't help anyone verifying from another machine, and
emulation makes local builds slower.

## Recommendation

1. Confirm the architecture cause with a local `linux/amd64` build.
2. Strip the provenance section in api-compile, add the reproducibility test,
   and rewrite or re-record the packages already in R2.
3. Open an issue on the compiler so the provenance hash no longer depends on the
   host, and remove the stripping once a compiler release fixes it.
