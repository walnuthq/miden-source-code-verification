# Area guides

Before working in one of these areas, read its file in `docs/claude/`. Their rules aren't loaded otherwise.

| Working on                                                                                                                   | Read                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Skills (`.agents/skills`, `.claude/skills`, `skills-lock.json`), `npx skills`                                                | `skills.md`              |
| `apps/api-registry/src/db/schema.ts`, its `drizzle/` migrations, relational queries, `drizzle-kit` bumps                     | `database-migrations.md` |
| A new per-package registry column that the web-viewer reads, admin routes, `ADMIN_TOKEN`                                     | `registry-backfill.md`   |
| Writing or running the api-compile and api-registry suites, fixtures (`packages/test-utils`), which network a test may touch | `testing.md`             |
| `apps/api-compile/examples/**/Cargo.lock`, `cargo update`, toolchain bumps, `GET /lockfile`, `warmLockfile`                  | `warm-lockfile.md`       |
| After a merge: checking a deploy or an api-compile container rollout, anything that touches production                       | `deploys.md`             |
| Running api-compile or api-registry on the host, checking UI changes, `wrangler dev` in `apps/*-cloudflare`                  | `local-development.md`   |
| Bumping dependencies, pnpm or `packageManager`                                                                               | `dependency-bumps.md`    |
| `POST /compile-debug`, debug packages and their commitments, cargo profiles                                                  | `debug-builds.md`        |

# Rules that bite outside their area

- The Node packages (api-compile, api-registry, api-docs, the status-page scripts, utils, test-utils) run their TypeScript on Node 26 (`engines: >=26 <27`) directly, with no tsx. Import local files by relative path with the `.ts` extension (`../lib/errors.ts`). No `@/` aliases and no `.js` specifiers: Node resolves neither. `tsc` rewrites `.ts` to `.js` on build (`rewriteRelativeImportExtensions`).
- Only erasable syntax (`erasableSyntaxOnly`): no enums, namespaces or constructor parameter properties.
- `.env` is loaded by the command, not the module: `node --env-file-if-exists=.env …` in scripts, `process.loadEnvFile()` in vitest setup files. Don't add dotenv. Shell variables win over `.env`.
- The api-compile and api-registry suites test whatever listens on `localhost:8080`/`8081`, normally the docker compose stack: rebuild it (`docker compose up -d --build`) before testing a server change, or they test the old images.
- Check web-viewer and web-verifier changes against their dev servers (`pnpm --filter ./apps/<app> dev`), not by rebuilding the compose images: rebuild a container only when its Rust crate changes.
- Docker images install a pinned corepack (`npm install -g corepack@…`), since Node 25+ doesn't bundle it. All four Dockerfiles share that base stage: change them together.
- After a `cargo update` of the examples' lockfiles or a toolchain bump, the Playground's project-template lockfile must be re-synced against the new image and shipped with it, or every Playground build loses the warm cache. `warm-lockfile.md` has the steps.
- Routes in api-compile and api-registry don't catch. Throw, or let the error propagate: the shared `errorHandler` (`packages/utils/src/http-errors.ts`, mounted last in both apps) answers an error that carries a `status` with that status, its `headers` and its message (`HttpError`, `BusyError`, `VerifierError`, `ApiCompileError`), anything else as a 500 with its message, logs 500s, and stays silent once the client is gone. Validation stays an early `res.status(400).json(…)`; don't add a route-level `try`/`catch` that maps errors to responses (the 2026-11 error-handler refactor removed 15 of them).
- The shadcn skill's advice to render a link as `<Button render={<a />} nativeButton={false}>` is wrong here: Base UI forces `role="button"` on the `<a>`. Style links with `buttonVariants` on a plain `<a>`, as `packages/ui/src/components/navbar.tsx` does.

## Agent skills

### Issue tracker

GitHub Issues on `walnuthq/miden-source-code-verification`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
