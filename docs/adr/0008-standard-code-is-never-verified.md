# Standard code is never verified, and one list says what standard code is

**Accepted** (2026-11-28).

An account made of standard components alone, and a standard note, are never verified, whatever package is sent. Miden publishes their source with itself (`miden-standards`), and a verified record says who submitted the package: letting a copy of that source verify them would let anyone claim every wallet, faucet and P2ID note on a network, as #162's first draft would have. A standard component inside an account that also has custom code is still accounted for like any procedure, so a copy of the basic wallet verifies the counter account's wallet procedures. The registry's lookup by id answers such a resource with its usual 404, which names the standard components or the standard note, and the web-viewer shows that instead of offering to verify.

What counts as standard is one list, `apps/api-compile/crates/standard-components`, which both `miden-import` (the names the web-viewer shows) and `miden-verifier` (whether an account has custom code) classify with. Upstream's own detection, which the verifier used before, knows 14 of the crate's 34 components: the verifier then took SchemaCommitment, Pausable or a mint policy for custom code, and a copy of one verified an account of standard components alone. Two lists would drift the same way, so a component the web-viewer labels as standard is one no package verifies alone. The list's test fails when the copy of the crate's MASM (`apps/api-compile/miden-standards`, synced after each bump) has a component it doesn't name.

## Considered options

- **Verify an exact copy of standard code** (#162's first draft). Rejected for the claim above: the copy is public, so verifying it proves nothing about who deployed the account.
- **Answer standard resources with a record-less 200** instead of a 404. Rejected to keep a verified record, and only a verified record, behind every 200 of the lookup.

## Consequences

- Records the registry made before #162 for accounts whose only custom code was one of the 20 components upstream doesn't detect are not removed. `pnpm --filter ./apps/api-registry find-standard-records` lists the records whose packages hold standard code only, for review.
- Standard components are recognised by procedure root alone, and some are trivial (`burn::allow_all::check_policy` is `dropw dropw`): a custom procedure with the same body is taken for that component.
