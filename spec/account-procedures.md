# Account procedures a note or transaction script calls

Status: **in progress** (2026-11-13). Steps 1–7 done on branch `feat/account-procedures`; step 8 (deploy, production check) waits on the merge. This is the api-compile half. The Playground half is `spec/simulate-target-accounts.md` in walnuthq/miden-playground; ship this half and deploy it first.

## Why

The Miden Playground's script page has a Simulate tab. For a note or transaction script, it runs the script against a **target account** that the user picks from a dropdown of the sandbox's accounts. Today the dropdown lists every account. Most of them can't run the script: for example, a counter note calls the counter component's `increment`, and an account without that procedure fails the run with an unhelpful VM error.

The Playground will **hide every account whose code lacks a procedure the script calls**. To do that it needs the list of those procedures, by MAST root. Only the compiled package has it, and api-compile already reads every package with `miden-package-metadata`. So: `miden-package-metadata` lists the procedures, and `POST /compile` (and `POST /verify`) return the list as `accountProcedures`.

We decided against looking at a script's package **dependencies** instead. A dependency isn't a call, and the Playground's per-account list of verified components only covers components that its workspace knows.

## Background: how a script reaches its account

- Account code is a set of procedures identified by their MAST roots (digests). The web SDK's `AccountCode.hasProcedure(word)` answers "does the account have this root". The Playground already uses it to verify an account's components: a component counts as verified when the account has every one of its procedure-export digests.
- A note script or a transaction script runs **outside** the account context and reaches account procedures with `call`, which switches context. In the MAST that is a `MastNode::Call` whose `callee` is a node in the same forest. When the callee isn't linked into the package, the callee is a `MastNode::External` that carries only the digest. Kernel procedures are reached with `syscall` (`Call` with `is_syscall()`). Those, and the `miden::protocol` wrappers that do it, are not account procedures.
- Calls into the standards library's basic wallet (`receive_asset`, `move_asset_to_note`), for example from P2ID, are account procedures too. Their digest also appears as a procedure root of `StandardsLib`.
- The compiler (cargo-miden 0.11, toolchain 0.17) compiles a Rust note that calls a dependency component's binding into a `call` to that component's export. Step 1 checked this on 2026-11-13; see "Spike result".

## Output contract

`miden-package-metadata` prints a new top-level key, but **only for packages whose kind is `note` or `transaction-script`** (`package.kind`). The key is absent for every other kind.

```json
"accountProcedures": ["0x…", "0x…"]   // sorted, deduplicated MAST roots, Word::to_hex()
"accountProcedures": []               // the script calls no account procedure
"accountProcedures": null             // can't be told: a dynamic call (dyn / dyncall) is reachable
```

Consumers treat an absent key (an older api-compile, or another kind of package) and `null` the same way: no filter.

## Steps

1. **Spike (do first, report before going on).**
   - Compile the Playground's `counter-contract` example (`apps/api/examples/counter-contract` in miden-playground; the notes `increment-note` and the transaction script) and its P2ID template.
   - Dump the MAST from each script's entry procedure.
   - Confirm three things:
     - (a) the account calls are `Call` nodes, reached from the entry by `Join`/`Split`/`Loop`/`exec`.
     - (b) the callee digest equals the dependency component's procedure-export digest, which is what `AccountCode.hasProcedure` matches. For the counter, that is `increment`'s digest in the `counter-account` package's manifest.
     - (c) whether the compiler emits any `call` to a procedure that the script's own package defines (it shouldn't).
   - If the calls are emitted some other way (a local wrapper that is `call`ed, or a `dyncall` through a procedure reference), stop and write down what you found here: the walker in step 2 must change.
   - **Spike result (2026-11-13, cargo-miden 0.11.0, release builds).** Scripts checked: this repo's `counter-note`, `counter-script` and `basic-wallet-tx-script` examples (`counter-note` has the same source as the Playground's `increment-note`), the Playground's P2ID template built against the `basic-wallet` example, and `miden-bank/init-tx-script`. All three assumptions hold, so step 2 stands as written.
     - (a) Every account call is a non-syscall `Call` in the package forest, reached from the entry through `Join`/`Split`/`Loop` and `exec`s into the core library. The callee is an `External` node.
     - (b) Each callee digest is the dependency component's export digest: counter-note calls `get-count` and `increment-count`, counter-script `increment-count`, P2ID `receive-asset`, the basic-wallet script `create-note` and `move-asset-to-note`, init-tx-script `initialize`. The P2ID template calls the `basic-wallet` example component, not `StandardsLib`'s wallet.
     - (c) No `call` targets a procedure root of the script's own package. The only other `Call` reached is a `syscall` inside `miden::protocol`.
     - Entry points: each script exports its entry (`run`, or `script` for P2ID) with the `note_script` / `transaction_script` marker. It also exports an unmarked `init`, which only `exec`s core, and P2ID exports a `#[note_constructor]` (`build-recipient`). Use the marker. The fallback to all exports would also pick these up; it's harmless here, since none of them calls the account.
2. **`apps/api-compile/crates/miden-package-metadata/src/account_procedures.rs`.**
   - Entry points: the package's procedure exports that carry the `note_script` or `transaction_script` attribute marker. If none carries one, use all procedure exports. Resolve each with `procedure.node.or_else(|| forest.find_procedure_root(procedure.digest))`, exactly like `read_only.rs` `Analyzer::exports`.
   - Walk depth-first with a `seen` set, over the package's forest and, through `External` nodes, the library forests: `CoreLibrary`, `ProtocolLib`, `StandardsLib`.
     - Move the forest list out of `read_only::Analyzer::default()` into a small shared helper (for example `libraries.rs`) so both passes use the same one.
     - Resolve externals the way `read_only.rs` does: the first forest with a procedure root of that digest that isn't itself an external node. An external that resolves nowhere is a call into a user library that can't be followed. Treat it as an `exec` boundary and don't record it, because `exec` doesn't switch context.
   - `Block`: nothing. `Join`/`Split`/`Loop`: follow the children.
   - `Call` with `is_syscall()`: nothing (kernel).
   - `Call` otherwise:
     - Take the callee's digest. If the callee is a non-external procedure root in the **script's own package forest**, follow it like an exec: it's the script's own code, not the account's. This should not happen per spike (c); keep the case anyway. As built, the callee must also have a digest that no library forest has. Otherwise a library procedure linked into the forest would be followed, not recorded: the standards P2ID test walks `StandardsLib`'s own forest, where `receive_asset` is a non-external root.
     - Otherwise record the digest and **don't follow** it: its body runs in the account's context.
   - `Dyn` (both `dyn` and `dyncall`): the result is `None`, printed as `null`. A dynamic `exec` can't call the account with a known root either, so any `Dyn` gives up.
   - Return `Option<Vec<Word>>`, sorted by hex and deduplicated.
3. **`main.rs`.** `mod account_procedures;`. For `kind` `note` or `transaction-script`, add `"accountProcedures"` (hex strings, or `null`) next to `readOnly`, with a comment in the same style. Update the JSON contract comment in `packages/utils/src/manifest.ts`.
4. **Rust tests** (`cargo test -p miden-package-metadata` in `apps/api-compile/crates`; CI doesn't run them, see `docs/claude/testing.md`):
   - The standards P2ID note script. The walker takes a forest and a root, so test it on the script's MAST directly. It returns exactly the basic wallet's `receive_asset` root (check the name against `StandardsLib`'s exports, not a hard-coded hex).
   - A transaction script assembled in the test that only `exec`s core procedures returns `[]`.
   - A script with a `dynexec` or `dyncall` returns `None`.
   - Duplicates and order: two calls to the same procedure return one entry.
5. **TypeScript plumbing.** Pass the field through exactly like `noteStorage`:
   - `apps/api-compile/src/lib/helper-tools.ts` `PackageMetadata`: `accountProcedures?: string[] | null`.
   - `src/lib/compile.ts`: destructure and return it.
   - `src/routes/compile.ts` and `src/routes/verify.ts`: return it.
   - `packages/utils/src/api-compile.ts`: `CompileResponse` gets it, with a doc comment.

   Out of scope: the registry (`apps/api-registry/src/lib/verify-resource.ts`) and the web viewer. Nobody needs the field there yet.
6. **api-compile tests** (`apps/api-compile/__tests__/compile.test.ts`, next to the `noteStorage` cases around line 460–531):
   - The counter note fixture returns its `increment` digest, equal to the one in the counter component's manifest.
   - An account component has no `accountProcedures` key.
7. **Docs.**
   - `docs/claude/registry-backfill.md`: nothing to backfill, since the registry doesn't store the field.
   - Add a line in `apps/api-compile/crates/miden-package-metadata` (module doc comment) saying what counts as an account procedure and why `null`.
8. **Deploy api-compile**, then check `POST /compile` on production with the counter note: the response has `accountProcedures`. The Playground PR goes after this.

## Gotchas

- Local api-compile runs the helper binaries from `PATH`. Rebuild them (`cargo build --release --locked --workspace` in `apps/api-compile/crates`) or the server keeps printing the old JSON without the key (`docs/claude/local-development.md`).
- `exec` of a standards-library procedure that itself `call`s the account (a wrapper) must be followed, so don't stop at library boundaries for `exec`. Only stop **after recording** a non-syscall `call`.
- A recompiled component has new procedure roots, so accounts deployed with the old build won't match. That's correct: the note really can't call them.
