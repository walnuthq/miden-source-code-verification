# syntax=docker/dockerfile:1

# web-viewer is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Pin pnpm via the root package.json "packageManager" field.
RUN corepack enable
WORKDIR /repo

# --- Build stage: install workspace deps, build, prune to prod ---
FROM base AS build
COPY . .
# Install only what web-viewer needs (and its workspace deps), with a cached store.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=miden-source-code-verification-web-viewer...
# react-router build -> apps/web-viewer/build/{client,server}. The trailing `...`
# builds web-viewer's workspace deps first (the utils package), whose dist/ is
# what the build bundles.
RUN pnpm --filter=miden-source-code-verification-web-viewer... build
# Produce a self-contained, production-only bundle (no workspace symlinks). See
# apps/api-registry/Dockerfile for why this is not --legacy.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=miden-source-code-verification-web-viewer --prod /prod/web-viewer

# --- Runtime stage: react-router-serve server-renders pages and serves build/client ---
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5174
WORKDIR /app
COPY --from=build --chown=node:node /prod/web-viewer .
USER node
EXPOSE 5174
# Invoke the bin directly (not via `pnpm start`) to bypass pnpm's
# verify-deps-before-run check, which would try to reinstall in the container.
CMD ["node", "node_modules/@react-router/serve/bin.cjs", "build/server/index.js"]
