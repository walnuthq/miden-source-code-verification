# syntax=docker/dockerfile:1

FROM node:24-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

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
COPY crates .

WORKDIR /home/node/crates/miden-package-metadata
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --path . --locked

WORKDIR /home/node/crates/miden-verifier
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --path . --locked

RUN strip /usr/local/cargo/bin/cargo-miden /usr/local/cargo/bin/miden-package-metadata /usr/local/cargo/bin/miden-verifier

# Build the API (TypeScript -> JS) — runs in parallel with rust-builder
FROM base AS api-builder
WORKDIR /home/node/api
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src src
RUN npm run build

# Production-only node_modules
FROM base AS api-deps
WORKDIR /home/node/api
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force

# Final runtime image — slim, no build tools
FROM base

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Rust toolchain (cargo + rustc + std) needed at runtime to compile user projects
COPY --from=rust-builder /usr/local/rustup /usr/local/rustup
COPY --from=rust-builder /usr/local/cargo /usr/local/cargo

# Copy project template
WORKDIR /cache/project-template
COPY project-template .
# Warm cargo-miden
WORKDIR /cache/project-template/counter-account
RUN CARGO_TARGET_DIR=/cache/target cargo miden build --release

WORKDIR /home/node/api
COPY package.json .
COPY --from=api-deps /home/node/api/node_modules node_modules
COPY --from=api-builder /home/node/api/dist dist

EXPOSE 8080
CMD ["npm", "start"]
