# syntax=docker/dockerfile:1

# api-compile is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

FROM node:26-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node 25+ no longer bundles corepack, so install it from npm (pinned). It
# pins pnpm via the root package.json "packageManager" field and checks its hash.
RUN npm install -g corepack@0.36.0 && corepack enable

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
# stage below shares one toolchain and the builds don't modify it. The same
# goes for the Wasm target the examples list: the runtime disables rustup's
# auto-install, so nothing installs it later.
RUN rustup component add rustfmt rust-src clippy rust-analyzer \
 && rustup target add wasm32-wasip2

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

# Final runtime image — slim, no build tools
FROM base AS runtime

# CARGO_HOME is not the toolchain's directory: cargo writes its registry cache
# and a lock file under it during a build, so it is the build's own fresh copy
# of the image's warm cache (see constants.ts), not the image's. The toolchain
# and the helper tools in /usr/local/cargo stay root's.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/cache/cargo-home \
    PATH=/usr/local/cargo/bin:$PATH \
    RUSTUP_AUTO_INSTALL=0

# RUSTUP_AUTO_INSTALL=0: a submitted rust-toolchain.toml that pins another
# toolchain fails the build right away, instead of rustup downloading that
# toolchain mid-request and the build then running against a cold cache.

# Rust toolchain (cargo + rustc + std) and cargo-miden, needed at runtime to
# compile user projects
COPY --from=cargo-miden-builder /usr/local/rustup /usr/local/rustup
COPY --from=cargo-miden-builder /usr/local/cargo /usr/local/cargo

# Two unprivileged users. The server stays root so it can start each subprocess
# as one of them (execFile's uid/gid): `builder` runs cargo, so everything build
# code can write is `builder`'s; `api` runs the helper tools, which own the
# client stores. Build code can write only its project directory, its home and
# the build's copies of /cache/target and /cache/cargo-home, which the server
# replaces before every build; /work is root's and traversable only, so no
# directory it can write is a parent of another request's project.
RUN groupadd --system --gid 10001 api \
 && useradd --system --uid 10001 --gid api --create-home --home-dir /home/api api \
 && groupadd --system --gid 10002 builder \
 && useradd --system --uid 10002 --gid builder --create-home --home-dir /home/builder builder \
 && mkdir -p /work/projects /work/resources /cache/stores \
 && chmod 0711 /work /work/projects /work/resources \
 && chown api:api /cache/stores
ENV BUILD_UID=10002 BUILD_GID=10002 API_UID=10001 API_GID=10001 \
    WORK_DIR=/work \
    WARM_CACHE_DIR=/cache/image \
    MIDEN_CLIENT_CACHE_DIR=/cache/stores

# Copy project template
WORKDIR /cache/examples
COPY apps/api-compile/examples .
# Warm cargo's dependency cache, in both profiles: each verification also
# builds its debug variant (dev profile), whose dependencies cargo builds
# separately from the release ones. One example is enough: user builds run in
# a fresh directory, so all they reuse from here is the compiled registry
# crates, and every example's Cargo.lock pins the same ones. `--locked`: the
# downloaded crates are what user builds resolve against (they run
# `--offline` first), so they must be exactly the ones the lockfile pins.
WORKDIR /cache/examples/counter-contract/counter-contract
# Built as root, in a scratch copy of the example, at the paths builds use:
# cargo records the CARGO_HOME path in its dependency fingerprints, so a cache
# copied to another path would recompile every dependency. The result then
# moves, in this same RUN (a later layer would duplicate it), to a read-only
# /cache/image; the server copies it back to the original paths before each
# build, so nothing build code changes reaches a later build. The chmod makes
# the warm-up's root-only files (lock files) readable for that copy.
RUN cp -r /cache/examples/counter-contract/counter-contract /tmp/warm \
 && cd /tmp/warm \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --release --locked \
 && CARGO_TARGET_DIR=/cache/target MIDENC_TARGET_DIR=/cache/target/miden cargo miden build --locked \
 && cd / && rm -rf /tmp/warm \
 && mkdir /cache/image \
 && mv /cache/target /cache/cargo-home /cache/image/ \
 && chmod -R go+rX,go-w /cache/image
# Each build gets a HOME of its own, deleted after it (see cargo-miden.ts):
# nothing may persist in the build user's home between builds.
RUN chown root:root /home/builder && chmod 0755 /home/builder

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

# Build code runs as `builder`; a setuid binary is its shortest way back to
# root, and the server, already root, needs none of them.
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +

EXPOSE 8080
# RLIMIT_NPROC, inherited by every subprocess and counted per user: a fork
# bomb in build code stops at 4096 tasks instead of taking the container down.
# prlimit execs node, which stays PID 1 and gets SIGTERM directly.
CMD ["prlimit", "--nproc=4096", "node", "dist/src/server.js"]
