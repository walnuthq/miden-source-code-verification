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

- The Node packages run their TypeScript on Node 26 directly, with no tsx, and `tsc` rewrites `.ts` imports to `.js` on build, so their relative imports end in `.ts`, which biome requires (`useImportExtensions`, scoped in `biome.json`).
- The api-compile and api-registry suites test whatever listens on `localhost:8080`/`8081`, normally the docker compose stack: rebuild it (`docker compose up -d --build`) before testing a server change, or they test the old images.
- Check web-viewer and web-verifier changes against their dev servers (`pnpm --filter ./apps/<app> dev`), not by rebuilding the compose images: rebuild a container only when its Rust crate changes.
- After a `cargo update` of the examples' lockfiles or a toolchain bump, the Playground's project-template lockfile must be re-synced against the new image and shipped with it, or every Playground build loses the warm cache. `warm-lockfile.md` has the steps.

## Agent skills

Run `/code-review main` before handing a PR to the user; it reviews against `CODING_STANDARDS.md`.

### Issue tracker

GitHub Issues on `walnuthq/miden-source-code-verification`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`. Specs live in `spec/`.
