# Debug builds

`POST /compile-debug` builds a package's debug profile, and the registry stores its commitment next to the release one (`debugCommitment`).

- A debug build's commitment depends on the architecture: production api-compile (x86_64) and the local compose container (aarch64 on Apple Silicon) give different debug commitments for the same source, each stable across requests, while the release commitment is the same on both. Pair debug builds with their release builds by export path only, never hard-code a debug commitment in a test that runs on different machines, and don't read a debug commitment mismatch as toolchain drift.
- cargo-miden (pinned in `apps/api-compile/Dockerfile`) passes `--config` for `profile.dev` itself, in midenc-compile's `src/pipeline/frontends/rust.rs`: panic=abort, opt-level=1, overflow-checks=false, debug=true, debug-assertions=false. CLI `--config` beats the environment, so `CARGO_PROFILE_DEV_OVERFLOW_CHECKS` and `CARGO_PROFILE_DEV_DEBUG_ASSERTIONS` change nothing, and dev builds don't panic on overflow where release wraps. Don't add those variables to `cargo miden build`; re-check that file on a cargo-miden upgrade.
