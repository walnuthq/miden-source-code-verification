# `POST /verify` answers the resource's root, and the registry never imports to learn it

The registry records a verification keyed on the resource's root. Since PR #93, `POST /verify` answers that `root` itself: the `code` `miden-verifier` reads on chain is the same root `miden-import` reads (`account.code().commitment()` for an account, `note_script.root()` for a note), so the registry dropped the second api-compile call and its second node read. An answer with no `root` is a 502 from the registry's api-compile adapter ("api-compile answered with no resource root"). That check began as cover for the rollout window, while an old container still answered without `root`, and it stays: there is no fallback to an import.

## Considered Options

- **Keep importing the resource after a successful verification.** Rejected: it costs an api-compile call and a node read to learn a root the verifier has already read.
- **Fall back to an import when `root` is missing.** Rejected: it would keep two paths to one fact alive after the rollout.
