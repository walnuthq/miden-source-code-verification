# api-docs

Static OpenAPI documentation for the Miden Source Code Verification `api-registry` service,
hosted on GitHub Pages.

It uses [`swagger-jsdoc`](https://github.com/Surnet/swagger-jsdoc) to build an
OpenAPI 3.1 spec from the `@openapi` JSDoc blocks written next to the route
handlers in `api-registry`, then bundles it with the
[`swagger-ui-dist`](https://www.npmjs.com/package/swagger-ui-dist) assets into a
fully static site (`dist/`). There is **no server at runtime** — the spec is
generated at build time and served as a plain `openapi.json` file.

> `api-compile` is an internal API and is intentionally **not** documented here.

## Sources

The spec is generated from JSDoc comments in:

- `apps/api-registry/src/**` — verified account & note registry

To document an endpoint, add an `@openapi` JSDoc block above its handler in
`api-registry`. The next build picks it up automatically — no changes needed
here.

## Build & preview

```bash
# Generate the static site into dist/
pnpm --filter miden-source-code-verification-api-docs build

# Build, then serve dist/ locally at http://localhost:8082
pnpm --filter miden-source-code-verification-api-docs dev

# Serve an already-built dist/ without rebuilding
pnpm --filter miden-source-code-verification-api-docs preview
```

The build emits, into `dist/`:

- the vendored Swagger UI assets (`index.html`, CSS, JS)
- `openapi.json` — the generated spec
- `swagger-initializer.js` — points Swagger UI at `./openapi.json`

> The spec is generated from TypeScript **source** files, so always build from a
> checkout of the monorepo.

## Deployment

Pushes to `main` that touch `apps/api-docs/**` or `apps/api-registry/src/**`
trigger the `Deploy Pages` GitHub Actions workflow
(`.github/workflows/deploy-pages.yml`). Enable Pages for the repo with
**Source: GitHub Actions**.

That workflow publishes the whole Pages site, not just these docs: this app's
`dist/` goes to the site root and `apps/status-page` goes under `/status/`, both
in a single artifact. A repository has exactly one Pages deployment and each
deploy replaces the entire site, so the two cannot ship from separate workflows.
It also runs hourly to refresh the status page, which redeploys these docs
unchanged as a side effect.

## Configuration

`API_REGISTRY_URL` populates the `servers` list shown in Swagger UI so requests
can be tried against a running instance (see `.env.example`). In CI it is read
from the `API_REGISTRY_URL` repository variable; if unset it defaults to
`http://localhost:8081`.
