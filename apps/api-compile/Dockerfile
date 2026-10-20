# syntax=docker/dockerfile:1

# api-compile is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

FROM node:24-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Pin pnpm via the root package.json "packageManager" field.
RUN corepack enable

# Rust toolchain (shared by builder and runtime)
FROM base AS rust

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --no-modify-path --profile minimal --default-toolchain nightly-2026-09-01
# The components the crates' rust-toolchain.toml lists (the examples' list a
# subset). rustup used to add them on the fly during the crate builds, and the
# runtime inherited them from there; install them once, up front, so every
# stage below shares one toolchain and the builds don't modify it.
RUN rustup component add rustfmt rust-src clippy rust-analyzer

# cargo-miden and the API's helper binaries build in two stages, so BuildKit
# builds them in parallel and caches them independently. Each stage gets its
# own cargo cache (`id=`), since parallel stages sharing one unpack the same
# crate at once on a cold cache and fail with "File exists (os error 17)". The
# cache is never persisted in a layer.
FROM rust AS cargo-miden-builder
RUN --mount=type=cache,id=cargo-registry-cargo-miden,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-cargo-miden,target=/usr/local/cargo/git \
    cargo install cargo-miden --version 0.11.0 \
 && strip /usr/local/cargo/bin/cargo-miden

# The helper binaries are one cargo workspace (apps/api-compile/crates), so the
# miden-client dependency tree they share compiles once. It compiles in its own
# layer first, against stub sources, keyed on the manifests and lockfile only:
# an edit to a crate's src/ then rebuilds that crate's own code, not its
# dependencies. generate-fixtures is a workspace member but isn't shipped, so
# only its manifest comes in (cargo needs every member to load the workspace).
FROM rust AS helpers-builder
WORKDIR /home/node/crates
COPY apps/api-compile/crates/Cargo.toml apps/api-compile/crates/Cargo.lock apps/api-compile/crates/rust-toolchain.toml ./
COPY apps/api-compile/crates/generate-fixtures/Cargo.toml generate-fixtures/
COPY apps/api-compile/crates/miden-import/Cargo.toml miden-import/
COPY apps/api-compile/crates/miden-package-metadata/Cargo.toml miden-package-metadata/
COPY apps/api-compile/crates/miden-verifier/Cargo.toml miden-verifier/
RUN for crate in generate-fixtures miden-import miden-package-metadata miden-verifier; do \
      mkdir -p $crate/src && echo 'fn main() {}' > $crate/src/main.rs; \
    done
RUN --mount=type=cache,id=cargo-registry-helpers,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-helpers,target=/usr/local/cargo/git \
    cargo build --release --locked --bin miden-import --bin miden-package-metadata --bin miden-verifier
COPY apps/api-compile/crates/miden-import/src miden-import/src
COPY apps/api-compile/crates/miden-package-metadata/src miden-package-metadata/src
COPY apps/api-compile/crates/miden-verifier/src miden-verifier/src
# COPY keeps the sources' mtimes, which can predate the stub build: touch them
# so cargo sees them as changed and rebuilds the three crates.
RUN --mount=type=cache,id=cargo-registry-helpers,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-helpers,target=/usr/local/cargo/git \
    touch miden-import/src/main.rs miden-package-metadata/src/main.rs miden-verifier/src/main.rs \
 && cargo build --release --locked --bin miden-import --bin miden-package-metadata --bin miden-verifier \
 && strip target/release/miden-import target/release/miden-package-metadata target/release/miden-verifier

# Build the API (TypeScript -> JS) from the pnpm workspace — runs in parallel with the Rust stages
FROM base AS api-builder
WORKDIR /repo
# The install needs only the workspace manifests and the lockfile: copied
# alone, an edit to source elsewhere in the repo doesn't rerun it. --parents
# keeps each package.json at its path (a plain glob COPY flattens them).
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc apps/*/package.json packages/*/package.json ./
# Install only what api-compile needs (and its workspace deps), with a cached store.
# --network-concurrency=2 (down from the default 16) for the slow-network Docker
# build only: on a thin pipe, many parallel multi-MB binary downloads (workerd,
# biome) starve each other into the fetch timeout; serializing lets
# each use the full bandwidth. The generous fetch timeout/retries live in
# pnpm-workspace.yaml (pnpm 11+ only honors these there, not in .npmrc).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency=2 --filter=miden-source-code-verification-api-compile...
# The sources. The root .dockerignore leaves out node_modules, so this doesn't
# overwrite what the install just wrote.
COPY . .
# Compile TypeScript -> dist/ (tsc + tsc-alias rewrites the @/* path aliases).
# The trailing `...` also builds api-compile's workspace deps (e.g. the utils
# package) first, so their JS exists in dist/. Production runs on plain `node`,
# which cannot type-strip the raw .ts these packages ship for dev (that is the
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING error); the built JS is what the
# package's default export condition resolves to at runtime.
RUN pnpm --filter=miden-source-code-verification-api-compile... build
# Produce a self-contained, production-only bundle (no workspace symlinks).
# No --legacy: pnpm 12's legacy deploy stages paths through /repo/node_modules,
# and renaming a directory that lives in a lower image layer fails on overlayfs
# with EXDEV ("Invalid cross-device link"). The modern deploy reads the shared
# workspace lockfile and writes only to /prod, so it is unaffected.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=miden-source-code-verification-api-compile --prod /prod/api-compile

# Final runtime image — slim, no build tools
FROM base AS runtime

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Rust toolchain (cargo + rustc + std) and cargo-miden, needed at runtime to
# compile user projects
COPY --from=cargo-miden-builder /usr/local/rustup /usr/local/rustup
COPY --from=cargo-miden-builder /usr/local/cargo /usr/local/cargo

# Copy project template
WORKDIR /cache/examples
COPY apps/api-compile/examples .
# Warm cargo-miden with counter-contract, in both profiles: each verification
# also builds its debug variant (dev profile), whose dependencies cargo builds
# separately from the release ones.
WORKDIR /cache/examples/counter-contract/auth-component-no-auth
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/counter-contract/counter-contract
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/counter-contract/count-reader
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/counter-contract/counter-note
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/counter-contract/counter-script
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/miden-bank/bank-account
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/miden-bank/deposit-note
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/miden-bank/init-tx-script
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build
WORKDIR /cache/examples/miden-bank/withdraw-request-note
RUN CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build

# The API's helper binaries, copied after the warm-up builds, which don't use
# them: a change to one of these crates then doesn't redo the warm-up.
COPY --from=helpers-builder \
     /home/node/crates/target/release/miden-import \
     /home/node/crates/target/release/miden-package-metadata \
     /home/node/crates/target/release/miden-verifier \
     /usr/local/cargo/bin/

# App: only the built output + production dependencies from the deploy bundle
WORKDIR /home/node/api
COPY --from=api-builder /prod/api-compile/package.json .
COPY --from=api-builder /prod/api-compile/node_modules node_modules
COPY --from=api-builder /prod/api-compile/dist dist

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
