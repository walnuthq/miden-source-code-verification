# syntax=docker/dockerfile:1

# api-compile is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

# What every stage starts from. The helper tools verify the Miden nodes' TLS
# certificates against the platform's roots, so the runtime needs them too.
FROM node:26-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The Rust toolchain, a build stage only: the runtime gets the four binaries
# built with it.
FROM base AS rust
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --no-modify-path --profile minimal --default-toolchain nightly-2026-09-01
# The components the crates' rust-toolchain.toml lists, installed up front so
# the builds below don't modify the toolchain.
RUN rustup component add rustfmt rust-src clippy rust-analyzer

# The helper binaries are one cargo workspace (apps/api-compile/crates), so the
# miden-client dependency tree they share compiles once. It compiles in its own
# layer first, against stub sources, keyed on the manifests and lockfile only:
# an edit to a crate's src/ then rebuilds that crate's own code, not its
# dependencies. generate-fixtures is a workspace member but isn't shipped, so
# only its manifest comes in (cargo needs every member to load the workspace).
# The cargo cache is never persisted in a layer.
FROM rust AS helpers-builder
WORKDIR /home/node/crates
COPY apps/api-compile/crates/Cargo.toml apps/api-compile/crates/Cargo.lock apps/api-compile/crates/rust-toolchain.toml ./
COPY apps/api-compile/crates/generate-fixtures/Cargo.toml generate-fixtures/
COPY apps/api-compile/crates/miden-assemble/Cargo.toml apps/api-compile/crates/miden-assemble/build.rs miden-assemble/
COPY apps/api-compile/crates/miden-import/Cargo.toml miden-import/
COPY apps/api-compile/crates/miden-package-metadata/Cargo.toml miden-package-metadata/
COPY apps/api-compile/crates/miden-verifier/Cargo.toml miden-verifier/
COPY apps/api-compile/crates/standard-components/Cargo.toml standard-components/
RUN for crate in generate-fixtures miden-assemble miden-import miden-package-metadata miden-verifier; do \
      mkdir -p $crate/src && echo 'fn main() {}' > $crate/src/main.rs; \
    done \
 && mkdir -p standard-components/src && touch standard-components/src/lib.rs
RUN --mount=type=cache,id=cargo-registry-helpers,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-helpers,target=/usr/local/cargo/git \
    cargo build --release --locked --bin miden-assemble --bin miden-import --bin miden-package-metadata --bin miden-verifier
COPY apps/api-compile/crates/miden-assemble/src miden-assemble/src
COPY apps/api-compile/crates/miden-import/src miden-import/src
COPY apps/api-compile/crates/miden-package-metadata/src miden-package-metadata/src
COPY apps/api-compile/crates/miden-verifier/src miden-verifier/src
COPY apps/api-compile/crates/standard-components/src standard-components/src
# COPY keeps the sources' mtimes, which can predate the stub build: touch them
# so cargo sees them as changed and rebuilds the five crates.
RUN --mount=type=cache,id=cargo-registry-helpers,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-helpers,target=/usr/local/cargo/git \
    touch miden-assemble/src/main.rs miden-assemble/src/lib.rs miden-import/src/main.rs miden-package-metadata/src/main.rs miden-verifier/src/main.rs standard-components/src/lib.rs \
 && cargo build --release --locked --bin miden-assemble --bin miden-import --bin miden-package-metadata --bin miden-verifier \
 && strip target/release/miden-assemble target/release/miden-import target/release/miden-package-metadata target/release/miden-verifier

# Build the API (TypeScript -> JS) from the pnpm workspace — runs in parallel with the Rust stages
FROM base AS api-builder
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node 25+ no longer bundles corepack, so install it from npm (pinned). It
# pins pnpm via the root package.json "packageManager" field and checks its hash.
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /repo
# The install needs only the workspace manifests and the lockfile: copied
# alone, an edit to source elsewhere in the repo doesn't rerun it. --parents
# keeps each package.json at its path (a plain glob COPY flattens them).
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc apps/*/package.json packages/*/package.json ./
# Install only what api-compile needs (and its workspace deps), with a cached store.
# --network-concurrency=2 (down from the default 16) for the slow-network Docker
# build only: on a thin pipe, many parallel multi-MB binary downloads (workerd,
# oxlint, oxfmt) starve each other into the fetch timeout; serializing lets
# each use the full bandwidth. The generous fetch timeout/retries live in
# pnpm-workspace.yaml (pnpm 11+ only honors these there, not in .npmrc).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency=2 --filter=miden-source-code-verification-api-compile...
# The sources. The root .dockerignore leaves out node_modules, so this doesn't
# overwrite what the install just wrote.
COPY . .
# Compile TypeScript -> dist/ (tsc rewrites the .ts import extensions to .js).
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

# Final runtime image: Node and the four helper binaries.
FROM base AS runtime

# The server stays root, so it can write each request's files and start the
# helper tools as `api` (execFile's uid/gid), which owns the client stores.
# /work is root's and traversable only, so no request's directory is listed by
# another's tools.
RUN groupadd --system --gid 10001 api \
 && useradd --system --uid 10001 --gid api --create-home --home-dir /home/api api \
 && mkdir -p /work/projects /work/resources /cache/stores \
 && chmod 0711 /work /work/projects /work/resources \
 && chown api:api /cache/stores
ENV API_UID=10001 API_GID=10001 \
    WORK_DIR=/work \
    MIDEN_CLIENT_CACHE_DIR=/cache/stores

COPY --from=helpers-builder \
     /home/node/crates/target/release/miden-assemble \
     /home/node/crates/target/release/miden-import \
     /home/node/crates/target/release/miden-package-metadata \
     /home/node/crates/target/release/miden-verifier \
     /usr/local/bin/

# App: only the built output + production dependencies from the deploy bundle
WORKDIR /home/node/api
COPY --from=api-builder /prod/api-compile/package.json .
COPY --from=api-builder /prod/api-compile/node_modules node_modules
COPY --from=api-builder /prod/api-compile/dist dist

# The helper tools parse untrusted input as `api` (ADR 0007, "What remains
# exposed"): a setuid binary would be the shortest way from a bug in one back
# to root, and the server, already root, needs none of them.
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +

EXPOSE 8080
# RLIMIT_NPROC, inherited by every subprocess and counted per user: a helper
# tool gone wrong stops at 4096 tasks instead of taking the container down.
# prlimit execs node, which stays PID 1 and gets SIGTERM directly.
CMD ["prlimit", "--nproc=4096", "node", "dist/src/server.js"]
