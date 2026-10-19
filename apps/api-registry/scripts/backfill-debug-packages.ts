// Builds and stores the debug build of every account-component package the
// registry stored before it kept them, through the registry's `/admin` routes.
//
//   REGISTRY_URL=https://… ADMIN_TOKEN=… \
//     pnpm --filter miden-source-code-verification-api-registry \
//     exec tsx scripts/backfill-debug-packages.ts
//
// Packages go one at a time: api-compile builds one at a time anyway. A busy
// api-compile (503) is retried after its `Retry-After`. A package whose release
// build the current toolchain no longer reproduces (409), or whose entrypoint
// can't be told (422), is skipped and keeps no debug build until it is verified
// again.
import "dotenv/config";

const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8081";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const MAX_RETRIES = 10;

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };

type PendingPackage = {
  id: string;
  name: string;
  commitment: string;
  entrypoint: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorOf = async (response: Response) => {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: string }
    | undefined;
  return body?.error ?? `HTTP ${response.status}`;
};

const backfill = async ({ commitment }: PendingPackage) => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `${REGISTRY_URL}/admin/packages/${commitment}/debug-build`,
      { method: "POST", headers },
    );
    if (response.ok) {
      const { debugCommitment } = (await response.json()) as {
        debugCommitment: string;
      };
      return { outcome: "stored", detail: debugCommitment } as const;
    }
    if (response.status === 503 && attempt < MAX_RETRIES) {
      const seconds = Number(response.headers.get("Retry-After")) || 30;
      console.info(`  api-compile busy, retrying in ${seconds}s`);
      await sleep(seconds * 1000);
      continue;
    }
    const detail = await errorOf(response);
    if (response.status === 409 || response.status === 422) {
      return { outcome: "skipped", detail } as const;
    }
    return { outcome: "failed", detail } as const;
  }
};

const pendingResponse = await fetch(
  `${REGISTRY_URL}/admin/debug-builds/pending`,
  { headers },
);
if (!pendingResponse.ok) {
  console.error(`listing failed: ${await errorOf(pendingResponse)}`);
  process.exit(1);
}
const pending = (await pendingResponse.json()) as PendingPackage[];
console.info(`${pending.length} package(s) without a debug build`);

const summary = { stored: 0, skipped: 0, failed: 0 };
for (const dbPackage of pending) {
  console.info(`${dbPackage.name} ${dbPackage.commitment}`);
  const { outcome, detail } = await backfill(dbPackage).catch(
    (error: unknown) =>
      ({
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      }) as const,
  );
  summary[outcome]++;
  console.info(`  ${outcome}: ${detail}`);
}
console.info(
  `stored ${summary.stored}, skipped ${summary.skipped}, failed ${summary.failed}`,
);
process.exitCode = summary.failed > 0 ? 1 : 0;
