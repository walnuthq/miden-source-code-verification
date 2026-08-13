/**
 * Where the last published snapshot lives.
 *
 * That file is the probe's only memory: it is what tells scripts/notify.ts
 * whether an outage is new. Both scripts need this URL — the probe to read the
 * snapshot, notify to link to the page — and it is *not* the repository root
 * the way it is for a repo whose Pages site is only a status page: api-docs
 * owns the root here and this page is published under `/status/` (see
 * `base` in vite.config.ts and the `Assemble site` step in
 * .github/workflows/deploy-pages.yml). Deriving that in two places would invite
 * the two copies to drift, so it lives here.
 *
 * Derived from the repository so a fork reads its own state rather than
 * walnuthq's. Null when neither variable is set — which is the local case, and
 * is why local runs never notify.
 */
export const statusPageUrl = (): string | null => {
  if (process.env.STATUS_PAGE_URL) return process.env.STATUS_PAGE_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return null;
  const [owner, name] = repository.split("/");
  if (!owner || !name) return null;
  // github.io hosts are lowercase; repository owners are not necessarily.
  return `https://${owner.toLowerCase()}.github.io/${name}/status/`;
};
