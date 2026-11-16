# Whether an exported procedure makes a foreign call

Status: **deployed** (2026-11-16, PR #142, api-compile container v113). Production `POST /compile` of the counter example returns `callsForeign` with every export `false`; the Playground half can start. This is the api-compile half. The Playground half is PR B of `spec/generic-invoke-and-foreign-calls.md` in walnuthq/miden-playground; ship this half and deploy it first.

## Why

The Miden Playground's Simulate tab runs an account component's procedures on a throwaway account in a mock client. A procedure that makes a foreign procedure invocation (FPI) can't run there: the mock chain only knows the accounts committed on it, and its RPC unwraps the lookup of an account it doesn't have, so the run panics inside the WASM instead of failing.

The Playground will **refuse to simulate a procedure that makes a foreign call**, and say why. To do that it needs to know, per exported procedure, whether a foreign call is reachable. Only the compiled package has it, and `miden-package-metadata` already walks every export's MAST for `readOnly`.

## Background: what a foreign call looks like

- User code reaches FPI through one protocol procedure, `miden::protocol::tx::execute_foreign_procedure`. The Rust compiler lowers a call on an `#[account(...)]` binding to `exec.::miden::protocol::tx::execute_foreign_procedure` (`codegen/masm/src/lower/fpi.rs` in 0xMiden/compiler).
- In a package's MAST that is an external node, or a linked-in procedure root, whose digest is the protocol library's export. `read_only.rs` already matches protocol procedures by digest in both forms (`protocol_access`), and lists this one in `PROTOCOL_READ_ONLY`.
- The foreign account id and the foreign procedure's root are **not** recoverable: the compiler stores them in locals and loads them at the call. This spec reports that a foreign call is reachable, not which one.

## Output contract

`miden-package-metadata` prints a new top-level key, next to `readOnly` and with the same shape: a map from export path to a value, for every procedure export of every package kind.

```json
"callsForeign": {
  "::\"miden:count-reader/count-reader@0.1.0\"::\"copy-count\"": true,
  "::\"miden:counter-account/counter-contract@0.1.0\"::\"get-count\"": false
}
```

- `true`: `tx::execute_foreign_procedure` is reachable from the export.
- `false`: it isn't, and everything reachable could be followed.
- `null`: it wasn't found, but something couldn't be followed: a dynamic call (`dyn`, `dyncall`), an external procedure that resolves to none of the core, protocol and standards libraries, or an export whose root isn't in the package's forest.

`true` wins over `null`: one reachable foreign call is enough, whatever else can't be followed.

Consumers act on `true` only. An absent key (an older api-compile) reads as `null`.

## Steps

1. **A new module, `src/foreign_calls.rs`**, not a change to `read_only::Analyzer::procedure`: that walk returns as soon as it finds a state-changing procedure, so it can't also answer this.
   - Find the digest of `::miden::protocol::tx::execute_foreign_procedure` in `ProtocolLib::default()`'s manifest, once. Panic with a clear message if it isn't exported: a protocol bump that renames it must fail the build's tests, not report `false` for everything.
   - Walk from each procedure export's root (`procedure.node`, or `forest.find_procedure_root(procedure.digest)`), over the package's forest and `libraries::forests()`, with the same node handling as `read_only.rs`: `Join`, `Split`, `Loop`, `Call` (follow the callee), `External` (resolve with `libraries::resolve`, follow when found), `Dyn`.
   - Check each node's digest against the foreign procedure's **before** matching on its kind, as `read_only.rs` does for protocol procedures: the match covers an external node and a linked-in root alike.
   - Don't stop at other protocol procedures: none of them can reach a foreign call, but following them is harmless and keeps the walk free of a second list. Syscalls are leaves.
   - Return `Some(true)`, `Some(false)` or `None` per the contract.
2. **`src/main.rs`**: add `"callsForeign"` to the metadata next to `"readOnly"`, built the same way, with a comment stating the three values. Declare the module.
3. **Unit tests** in the module, in the style of `account_procedures.rs`'s (`CodeBuilder`, small MASM sources):
   - a procedure that `exec`s `::miden::protocol::tx::execute_foreign_procedure` is `true`;
   - one that reaches it through a second procedure of the same library is `true`;
   - one that only reads storage (`active_account::get_item`) is `false`;
   - one with a `dynexec` and no foreign call is `None`;
   - one with a `dynexec` **and** a foreign call is `true`;
   - a state-changing procedure that also makes a foreign call is `true` (the reason this isn't in `read_only.rs`'s walk).
4. **Check on real packages.** Build the Playground's `count-reader` template with its `counter-account` dependency (`apps/api/templates/count-reader.rs` and `counter-account.rs` in miden-playground) and run `miden-package-metadata` on both:
   - `count-reader`: `copy-count` is `true`.
   - `counter-account`: every export is `false`.
   - If `copy-count` isn't `true`, dump its MAST and find how the foreign call is represented before changing the walk. Report it.
5. **The API's response.** `POST /compile` returns the metadata tool's output: find where `readOnly` is passed through (`grep -rn readOnly apps/api-compile --include=*.rs --include=*.ts`, outside the metadata crate) and pass `callsForeign` the same way. Update the response's types, schemas and documentation wherever `readOnly` appears in them, the `miden-source-code-verification-schemas` repository included if it describes this response.
6. **Tests of the service**: wherever a test asserts `readOnly` in a compile response, assert `callsForeign` too.
7. **Deploy, then check production**: `POST /compile` of the Playground's counter example returns `callsForeign` with every export `false`. Tell the Playground half it can start.

## Gotchas

- `readOnly` for a procedure that makes a foreign call is unchanged: `tx::execute_foreign_procedure` stays in `PROTOCOL_READ_ONLY`, since a foreign procedure can't change the foreign account's state.
- The key is for every package kind. A note or a transaction script can make a foreign call too; the Playground simulates those on its real client and ignores the flag for them today.
- Stored packages and the Playground's example snapshots (`compiled.json`) don't have the key until they're recompiled. That is the Playground half's concern.
