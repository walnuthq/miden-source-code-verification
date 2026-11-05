# api-compile's warm lockfile

The image warms cargo's cache from `apps/api-compile/examples/counter-contract/counter-contract/Cargo.lock`, which every example's lockfile matches, and builds run `--offline` first. Miden Playground (walnuthq/miden-playground) sends its own lockfile, `apps/api/templates/project-template/Cargo.lock`, which must pin the same registry crates.

- After a `cargo update` of the examples' lockfiles (or a toolchain bump), run `pnpm lockfile:sync` in the playground's `apps/api` against the new image, and ship both together. Otherwise every playground build downloads and rebuilds the crates that differ (176 s on production, lost each time the container sleeps).
- `GET /lockfile` serves the warm lockfile (`WARM_CARGO_LOCK`), for that check.
- `POST /compile` with `warmLockfile: true` re-resolves a lockfile that fails offline (`cargo update --offline`) before building online, and returns the updated lockfile. `/verify` and `/compile-debug` never do: they must build the exact lockfile they're sent.
