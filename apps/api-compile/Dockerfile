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

# Each Rust binary builds in its own stage, so BuildKit builds them in parallel
# and caches them independently: a change to one crate rebuilds that crate
# only. Each stage gets its own cargo cache (`id=`), since parallel stages
# sharing one unpack the same crate at once on a cold cache and fail with
# "File exists (os error 17)". The cache is never persisted in a layer.
FROM rust AS cargo-miden-builder
RUN --mount=type=cache,id=cargo-registry-cargo-miden,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-cargo-miden,target=/usr/local/cargo/git \
    cargo install cargo-miden --version 0.11.0 \
 && strip /usr/local/cargo/bin/cargo-miden

FROM rust AS miden-package-metadata-builder
WORKDIR /home/node/crates/miden-package-metadata
COPY apps/api-compile/crates/miden-package-metadata .
RUN --mount=type=cache,id=cargo-registry-miden-package-metadata,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-miden-package-metadata,target=/usr/local/cargo/git \
    cargo install --path . --locked \
 && strip /usr/local/cargo/bin/miden-package-metadata

FROM rust AS miden-verifier-builder
WORKDIR /home/node/crates/miden-verifier
COPY apps/api-compile/crates/miden-verifier .
RUN --mount=type=cache,id=cargo-registry-miden-verifier,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-miden-verifier,target=/usr/local/cargo/git \
    cargo install --path . --locked \
 && strip /usr/local/cargo/bin/miden-verifier

FROM rust AS miden-import-builder
WORKDIR /home/node/crates/miden-import
COPY apps/api-compile/crates/miden-import .
RUN --mount=type=cache,id=cargo-registry-miden-import,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-miden-import,target=/usr/local/cargo/git \
    cargo install --path . --locked \
 && strip /usr/local/cargo/bin/miden-import

# Build the API (TypeScript -> JS) from the pnpm workspace — runs in parallel with the Rust stages
FROM base AS api-builder
WORKDIR /repo
COPY . .
# Install only what api-compile needs (and its workspace deps), with a cached store.
# --network-concurrency=2 (down from the default 16) for the slow-network Docker
# build only: on a thin pipe, many parallel multi-MB binary downloads (workerd,
# biome) starve each other into the fetch timeout; serializing lets
# each use the full bandwidth. The generous fetch timeout/retries live in
# pnpm-workspace.yaml (pnpm 11+ only honors these there, not in .npmrc).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency=2 --filter=miden-source-code-verification-api-compile...
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

# The API's helper binaries, copied after the warm-up builds, which don't use
# them: a change to one of these crates then doesn't redo the warm-up.
COPY --from=miden-package-metadata-builder /usr/local/cargo/bin/miden-package-metadata /usr/local/cargo/bin/
COPY --from=miden-verifier-builder /usr/local/cargo/bin/miden-verifier /usr/local/cargo/bin/
COPY --from=miden-import-builder /usr/local/cargo/bin/miden-import /usr/local/cargo/bin/

# App: only the built output + production dependencies from the deploy bundle
WORKDIR /home/node/api
COPY --from=api-builder /prod/api-compile/package.json .
COPY --from=api-builder /prod/api-compile/node_modules node_modules
COPY --from=api-builder /prod/api-compile/dist dist

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
