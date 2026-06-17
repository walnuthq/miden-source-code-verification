# syntax=docker/dockerfile:1

# web-verifier is a pnpm workspace package, so the build context is the monorepo
# root (it needs pnpm-lock.yaml + the workspace manifests). See the root
# .dockerignore for what is excluded from the context.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Pin pnpm via the root package.json "packageManager" field.
RUN corepack enable
WORKDIR /repo

# --- Build stage: install workspace deps, build the Vite SPA -> dist/ ---
FROM base AS build
COPY . .
# Install only what web-verifier needs (and its workspace deps), with a cached store.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=miden-source-code-verification-web-verifier...
# Build-time API endpoint baked into the SPA. The browser runs on the host, so it
# reaches api-registry via its host-published port (not the in-network DNS name).
# Overridable at build (--build-arg) or at runtime via the app's Settings dialog.
ARG VITE_API_REGISTRY_URL=http://localhost:8081
ENV VITE_API_REGISTRY_URL=${VITE_API_REGISTRY_URL}
# tsc -b + vite build -> apps/web-verifier/dist (static assets + WASM).
RUN pnpm --filter=miden-source-code-verification-web-verifier build

# --- Runtime stage: nginx serving the static build with COOP/COEP + SPA fallback ---
FROM nginx:alpine AS runtime
# Custom server config: cross-origin-isolation headers + client-side-routing fallback.
COPY apps/web-verifier/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-verifier/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's default CMD starts nginx in the foreground.
