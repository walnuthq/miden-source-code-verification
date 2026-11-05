# Backfilling package data

When the registry starts storing something new per package that the web-viewer reads with no fallback (like `read_only`), the user wants the backfill in the same PR, with no UI handling for the missing case.

- Ship the column nullable. Add admin routes on the registry, behind `ADMIN_TOKEN` (they run there because the Worker holds the R2 and database bindings), plus a `scripts/backfill-*.ts` that drives them. Have the script exit non-zero on any package it can't fill, rather than skip it.
- If the value can be read from the stored `.masp`, read it there rather than rebuilding: a rebuild fails on packages the current toolchain no longer reproduces.
- A merge deploys every affected service at once, so older packages' pages break from the web-viewer deploy until the backfill has run. Run it as soon as api-compile's container rollout ends (check with `wrangler containers info`).
- Once it has run on production, remove the plumbing in a follow-up PR and make the column NOT NULL.
- The production `ADMIN_TOKEN` is a write-only Wrangler secret that nothing automated uses. If it's lost, set a new one with `wrangler secret put ADMIN_TOKEN` in `apps/api-registry-cloudflare`.
- A change to the analysis behind a stored value (for example the read-only classification in `apps/api-compile/crates/miden-package-metadata/src/read_only.rs`) doesn't update what the registry already stores: that needs a new backfill of the same shape.
