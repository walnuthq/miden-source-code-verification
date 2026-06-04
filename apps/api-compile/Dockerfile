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
  | sh -s -- -y --no-modify-path --profile minimal --default-toolchain nightly-2025-12-10

# Build cargo-miden + miden-package-metadata + miden-verifier (cargo cache via BuildKit, never persisted in layer)
FROM rust AS rust-builder
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install cargo-miden --locked

WORKDIR /home/node/crates
COPY apps/api-compile/crates .

WORKDIR /home/node/crates/miden-package-metadata
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --path . --locked

WORKDIR /home/node/crates/miden-verifier
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --path . --locked

RUN strip /usr/local/cargo/bin/cargo-miden /usr/local/cargo/bin/miden-package-metadata /usr/local/cargo/bin/miden-verifier

# Build the API (TypeScript -> JS) from the pnpm workspace — runs in parallel with rust-builder
FROM base AS api-builder
WORKDIR /repo
COPY . .
# Install only what api-compile needs (and its workspace deps), with a cached store.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=miden-sourcify-api-compile...
# Compile TypeScript -> dist/ (tsc + tsc-alias rewrites the @/* path aliases).
RUN pnpm --filter=miden-sourcify-api-compile build
# Produce a self-contained, production-only bundle (no workspace symlinks).
# --legacy is required since api-compile has no injected workspace deps (pnpm v10+).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --legacy --filter=miden-sourcify-api-compile --prod /prod/api-compile

# Final runtime image — slim, no build tools
FROM base AS runtime

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Rust toolchain (cargo + rustc + std) needed at runtime to compile user projects
COPY --from=rust-builder /usr/local/rustup /usr/local/rustup
COPY --from=rust-builder /usr/local/cargo /usr/local/cargo

# Copy project template
WORKDIR /cache/project-template
COPY apps/api-compile/project-template .
# Warm cargo-miden
WORKDIR /cache/project-template/counter-account
RUN CARGO_TARGET_DIR=/cache/target cargo miden build --release

# App: only the built output + production dependencies from the deploy bundle
WORKDIR /home/node/api
COPY --from=api-builder /prod/api-compile/package.json .
COPY --from=api-builder /prod/api-compile/node_modules node_modules
COPY --from=api-builder /prod/api-compile/dist dist

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
