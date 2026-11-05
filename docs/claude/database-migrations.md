# Drizzle

Only `apps/api-registry` uses Drizzle (`drizzle-orm` and `drizzle-kit` on 1.0 release candidates, pinned to the same version).

- After bumping `drizzle-kit`, run `pnpm exec drizzle-kit check` in `apps/api-registry`. If it asks for `drizzle-kit up`, run that and commit the rewritten `drizzle/*/snapshot.json` files with the bump. Otherwise the deploy workflow's `pnpm db:migrate` fails before the deploy. `up` must leave every `migration.sql` unchanged. Then `drizzle-kit generate --explain` should report `no_changes`.
- `docker compose up -d --build` runs `drizzle-kit migrate` (the `api-registry-migrate` service) against the local database, so a rebuild checks the migrations folder the way the deploy does.
- Relational query `where` values must never be `undefined`: since rc.5 it throws. Use `EmptyFilter` from `drizzle-orm/relations` for a filter that is meant to be absent.
- The deploy workflow runs `pnpm db:migrate` (with the `REGISTRY_DATABASE_URL` secret) before `wrangler deploy`, on every merge that touches `apps/api-registry` or the lockfile, so production's journal is complete. The old Worker serves on the new schema during the deploy window, and relational queries select every column, so code that knows a new column fails on an old schema: keep migrations additive (expand, then contract in a later release). Never `db:push` to production: it bypasses the journal.
