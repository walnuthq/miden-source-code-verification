# syntax=docker/dockerfile:1

# api-registry is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Pin pnpm via the root package.json "packageManager" field.
RUN corepack enable
WORKDIR /repo

# --- Build stage: install workspace deps, compile TS, prune to prod ---
FROM base AS build
COPY . .
# Install only what api-registry needs (and its workspace deps), with a cached store.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=miden-source-code-verification-api-registry...
# Compile TypeScript -> dist/ (tsc + tsc-alias rewrites the @/* path aliases).
RUN pnpm --filter=miden-source-code-verification-api-registry build
# Produce a self-contained, production-only bundle (no workspace symlinks).
# --legacy is required since api-registry has no injected workspace deps (pnpm v10+).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --legacy --filter=miden-source-code-verification-api-registry --prod /prod/api-registry

# --- Migrate stage: reuses the build stage (drizzle-kit + the committed
#     drizzle/ migrations) to apply versioned migrations. One-shot compose service. ---
FROM build AS migrate
# cwd must be the package dir so drizzle.config.ts resolves its relative paths
# (./drizzle, ./src/db/schema.ts) and DATABASE_URL.
WORKDIR /repo/apps/api-registry
# Invoke drizzle-kit directly (not via `pnpm run`) to bypass pnpm's
# verify-deps-before-run check, which would try to reinstall the filtered
# workspace and abort in a non-TTY container.
# The workspace uses pnpm's `hoisted` nodeLinker (flat, npm-style layout), so
# drizzle-kit lives in the repo-root node_modules, not the package's.
CMD ["node", "/repo/node_modules/drizzle-kit/bin.cjs", "migrate"]

# --- Runtime stage: minimal image with just the built app + prod deps ---
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/api-registry .
USER node
EXPOSE 8081
CMD ["node", "dist/src/server.js"]
