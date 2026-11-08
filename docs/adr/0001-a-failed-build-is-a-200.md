# A failed build is a 200 with `built: false`

`POST /compile` answers 200 for a build that fails, `{ built: false, stdout, stderr }`, as for one that builds (PR #93). A failed build is an outcome a compile client asked for, not an error, and the Miden Playground's API depends on that: it stores a failed build as an outcome and shows its diagnostics, while it answers its own users a plain-text 500 on any 4xx from api-compile. A failed build's `stderr` is part of the answer the Playground shows, so it is contract too ([0005](0005-cargo-miden-stays-off-the-helper-tool-runner.md)). `POST /verify` and `POST /compile-debug` answer 400 instead, since without a package they have nothing to check.

## Considered Options

- **A 400 for a failed build.** Rejected: the Playground would turn every compile error into a 500 for its users, so the change needs a cross-repo rollout first.
