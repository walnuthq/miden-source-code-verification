# `cargo miden build` stays off the helper-tool runner

api-compile runs its three helper tools through one runner (PR #94), which turns a failure into the tool's own stderr reason. cargo-miden is left out: it runs on the bounded `execFile`, so a failed build's `stderr` still starts with Node's line, `Command failed: cargo miden build …`. That `stderr` goes out in `POST /compile`'s failed-build answer ([0001](0001-a-failed-build-is-a-200.md)), and the Playground shows it to its users, so changing it changes the answer. cargo-miden's offline-then-online retry stays where it was too.

## Considered Options

- **Run cargo-miden through the helper-tool runner.** Rejected: the wire `stderr` of every failed build would change.
