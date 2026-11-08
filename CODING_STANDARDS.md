# Coding standards

The judgement rules a review checks a change against. Each rule says what, why, and where the code already does it. Rules that tsc or biome enforce are left to them.

## Errors and outcomes

### Routes throw, the error handler answers

Routes in api-compile and api-registry let errors propagate. The shared `errorHandler` (`packages/utils/src/http-errors.ts`, mounted last in both apps) answers an error that carries a `status` with that status, its `headers` and its message, and anything else as a 500. Request validation is the one early answer a route writes itself: `res.status(400).json({ error })`.

Why: one place decides how an error becomes a response, so every route answers the same shape. The 2026-11 error-handler refactor removed 15 route-level `try`/`catch` blocks that each mapped errors their own way. A `try`/`finally` that releases a resource is fine (`apps/api-compile/src/routes/verify.ts`); biome rejects a `catch` in a route (`biome/no-route-catch.grit`).

### Expected outcomes are values, exceptions are for the unexpected

An outcome the caller is meant to handle is part of the return type: `ProjectResult = { project } | { error }` (`packages/utils/src/project.ts`), `Build`, built or failed (`apps/api-compile/src/lib/compile.ts`), which `POST /compile` answers 200 either way. An outcome that ends the request is an `HttpError` subclass carrying its status and headers: `BusyError`, 503 with `Retry-After` (`apps/api-compile/src/lib/limiter.ts`), the 409 for an already verified resource (`apps/api-registry/src/lib/verify-resource.ts`).

Why: the type tells the caller which outcomes it must handle, and only an outcome that ends the request goes through the error handler.

### Answered messages are contract

The `error` strings the APIs answer are part of their contract: a refactor keeps them byte-identical (`missing Cargo.toml`, `invalid entrypoint` and the rest listed in `packages/utils/src/project.ts`). A new 400 reason gets its mention in the OpenAPI block and one test (`apps/api-compile/__tests__/compile.test.ts`).

Why: clients, the web apps and the status probe match on these strings.

### Logging belongs to the error handler

The error handler logs status 500 and above and stays silent once the client is gone (`packages/utils/src/http-errors.ts`). Routes leave logging to it.

Why: a 4xx is the client's mistake and an aborted request failed nothing; logging only real failures keeps the logs worth reading.

## Wire types

### Answers are typed once, in `packages/utils`

What api-compile and api-registry answer is typed in `packages/utils/src/api-compile.ts` and `api-registry.ts`. The producer builds its answer against those types: api-compile's routes `satisfies` them (`apps/api-compile/src/routes/compile.ts`), the registry maps its rows to them in `apps/api-registry/src/lib/verified-record.ts`. Every consumer (the registry's api-compile port, the web-viewer, the status probe) imports them. A new wire field starts in the shared type, then goes in the registry's OpenAPI block at the top of `apps/api-registry/src/app.ts`, which spells the same shapes under the same names.

Why: producer and consumers compile against one definition, so a changed field breaks the build instead of a client.

## Configuration

### `.env` is loaded by the command

Scripts load `.env` with `node --env-file-if-exists=.env …` (`apps/api-compile/package.json`); vitest setup files call `process.loadEnvFile()` (`apps/api-compile/__tests__/setup.ts`). Modules read `process.env` and nothing else; no dotenv.

Why: shell variables win over `.env`, and a module that loads its own env file would override them.

## Containers

### The four Dockerfiles change together

`apps/{api-compile,api-registry,web-viewer,web-verifier}/Dockerfile` share a base stage that installs a pinned corepack (`npm install -g corepack@…`), since Node 25+ doesn't bundle it. A change to that stage goes in all four.

Why: the images drift apart otherwise, and a pnpm or Node bump then works in some and fails in others.

## UI

### Links are a plain `<a>` styled with `buttonVariants`

Render a link as `<a className={cn(buttonVariants(…))}>`, as `packages/ui/src/components/navbar.tsx` does. The shadcn skill's `<Button render={<a />} nativeButton={false}>` is wrong here.

Why: Base UI forces `role="button"` on the `<a>`, so screen readers announce a link as a button.

## Tests and naming

- Test conventions (`request()` from test-utils, `fakeApiCompile`, `useFakeTool`, which network a test may touch) are in `docs/claude/testing.md`.
- Names of domain concepts come from `GLOSSARY.md`, as `docs/agents/domain.md` says.
