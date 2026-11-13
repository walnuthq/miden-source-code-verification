// Records the storage schemas of every package the registry stored before it
// kept them, through the registry's `/admin` routes.
//
//   REGISTRY_URL=https://… ADMIN_TOKEN=… \
//     pnpm --filter miden-source-code-verification-api-registry \
//     exec node --conditions development --env-file-if-exists=.env scripts/backfill-schemas.ts
//
// api-compile reads each package's stored `.masp`, without rebuilding it, so
// every package should succeed: the web-viewer assumes each one has them. One
// that doesn't is reported as failed and makes the script exit non-zero. An
// api-compile that is waking up or busy (502, 503, 504) is retried.
import { retryAfterSeconds } from "miden-source-code-verification-utils/api-registry";
import type { PackageSchemas } from "miden-source-code-verification-utils/manifest";

const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8081";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const MAX_RETRIES = 10;

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };

type PendingPackage = { id: string; name: string; commitment: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorOf = async (response: Response) => {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: string }
    | undefined;
  return body?.error ?? `HTTP ${response.status}`;
};

// What was stored, e.g. `2 storage slots` or `1 note storage field`.
const describe = ({ storage, noteStorage }: PackageSchemas) => {
  const parts = [
    storage && `${storage.slots.length} storage slot(s)`,
    noteStorage && `${noteStorage.fields.length} note storage field(s)`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "no schemas";
};

const backfill = async ({ commitment }: PendingPackage) => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `${REGISTRY_URL}/admin/packages/${commitment}/schemas`,
      { method: "POST", headers },
    );
    if (response.ok) {
      const { schemas } = (await response.json()) as {
        schemas: PackageSchemas;
      };
      return { stored: true, detail: describe(schemas) } as const;
    }
    if (
      response.status >= 502 &&
      response.status <= 504 &&
      attempt < MAX_RETRIES
    ) {
      const seconds = retryAfterSeconds(response.headers.get("Retry-After"));
      console.info(`  api-compile unavailable, retrying in ${seconds}s`);
      await sleep(seconds * 1000);
      continue;
    }
    return { stored: false, detail: await errorOf(response) } as const;
  }
};

const pendingResponse = await fetch(`${REGISTRY_URL}/admin/schemas/pending`, {
  headers,
});
if (!pendingResponse.ok) {
  console.error(`listing failed: ${await errorOf(pendingResponse)}`);
  process.exit(1);
}
const pending = (await pendingResponse.json()) as PendingPackage[];
console.info(`${pending.length} package(s) without storage schemas`);

const summary = { stored: 0, failed: 0 };
for (const dbPackage of pending) {
  console.info(`${dbPackage.name} ${dbPackage.commitment}`);
  const { stored, detail } = await backfill(dbPackage).catch(
    (error: unknown) =>
      ({
        stored: false,
        detail: error instanceof Error ? error.message : String(error),
      }) as const,
  );
  summary[stored ? "stored" : "failed"]++;
  console.info(`  ${stored ? "stored" : "failed"}: ${detail}`);
}
console.info(`stored ${summary.stored}, failed ${summary.failed}`);
process.exitCode = summary.failed > 0 ? 1 : 0;
