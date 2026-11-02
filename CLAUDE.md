## Agent skills

### Issue tracker

GitHub Issues on `walnuthq/miden-source-code-verification` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Project skills

Vendored in `.agents/skills/` and pinned by `skills-lock.json`, managed with the `skills` CLI (`npx skills add|update|remove`); `.claude/skills/` links to them. The `pnpm-drizzle-kit-*` skills come with `node_modules` and aren't committed. Personal settings go in `.claude/settings.local.json` or `CLAUDE.local.md`, both ignored.

- Add skills with `npx skills add <source> -s <name> -y` and no `-a`: that puts one copy in `.agents/skills` (read by Codex and Copilot) and links it from `.claude/skills`. `-a claude-code` copies it into `.claude/skills` instead.
- When adding a skill from a new source, add its license to `.agents/THIRD_PARTY_LICENSES/`.
- The shadcn skill is patched: its `SKILL.md` runs `npx shadcn@latest info --json -c packages/ui`, with a note to always pass `-c packages/ui`. From the repo root the CLI fails with `monorepo_root` and the skill won't load. `npx skills update` reverts the patch: re-apply it, and don't add a root `components.json` instead.
- The shadcn skill's advice to render a link as `<Button render={<a />} nativeButton={false}>` is wrong here: Base UI forces `role="button"` on the `<a>`. Style links with `buttonVariants` on a plain `<a>`, as `packages/ui/src/components/navbar.tsx` does.

## Node and TypeScript conventions

Node 26 (`engines: >=26 <27`). The Node packages (api-compile, api-registry, api-docs, the status-page scripts, utils, test-utils) run their TypeScript on Node directly, with no tsx:

- Import local files by relative path with the `.ts` extension (`../lib/errors.ts`). No `@/` aliases and no `.js` specifiers: Node resolves neither. `tsc` rewrites `.ts` to `.js` on build (`rewriteRelativeImportExtensions`).
- Only erasable syntax (`erasableSyntaxOnly`): no enums, namespaces or constructor parameter properties.
- `.env` is loaded by the command, not the module: `node --env-file-if-exists=.env …` in scripts, `process.loadEnvFile()` in vitest setup files. Don't add dotenv. Shell variables win over `.env`.
- API tests use `request()` from `miden-source-code-verification-test-utils` (a fetch-based, supertest-like builder), not supertest.

## Testing

The api-compile and api-registry suites call whatever is listening on `localhost:8080`/`8081` (`API_URL` overrides): normally the docker compose stack. To test a server change, rebuild and restart it first (`docker compose up -d --build`), or the suites test the old images.

Docker images install a pinned corepack (`npm install -g corepack@…`), since Node 25+ doesn't bundle it. All four Dockerfiles share that base stage: change them together.
