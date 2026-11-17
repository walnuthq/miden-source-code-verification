// Records the parameter names of every package the registry stored before it
// kept them, through the registry's `/admin` routes.
//
//   REGISTRY_URL=https://… ADMIN_TOKEN=… \
//     pnpm --filter miden-source-code-verification-api-registry \
//     exec node --conditions development --env-file-if-exists=.env scripts/backfill-parameters.ts
//
// api-compile reads each package's stored `.masp`, without rebuilding it, so
// every package should succeed. One it can't read is reported as failed and
// makes the script exit non-zero. A package without a `wit` section (a
// transaction script, or one built before `cargo-miden` 0.10) gets `{}`, and
// so does one whose WIT api-compile couldn't parse: both are counted apart, as
// their procedures keep unnamed parameters. An api-compile that is waking up
// or busy (502, 503, 504) is retried.
import { retryAfterSeconds } from "miden-source-code-verification-utils/api-registry";
import type { ProcedureParameters } from "miden-source-code-verification-utils/manifest";

const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8081";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const MAX_RETRIES = 10;

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };

type PendingPackage = { id: string; name: string; commitment: string };

type Outcome = "named" | "empty" | "unreadable" | "failed";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorOf = async (response: Response) => {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: string }
    | undefined;
  return body?.error ?? `HTTP ${response.status}`;
};

const backfill = async ({
  commitment,
}: PendingPackage): Promise<{ outcome: Outcome; detail: string }> => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `${REGISTRY_URL}/admin/packages/${commitment}/parameters`,
      { method: "POST", headers },
    );
    if (response.ok) {
      const { parameters, unreadable } = (await response.json()) as {
        parameters: ProcedureParameters;
        unreadable?: boolean;
      };
      const count = Object.keys(parameters).length;
      if (unreadable) {
        return { outcome: "unreadable", detail: "WIT unreadable, stored {}" };
      }
      return count > 0
        ? { outcome: "named", detail: `${count} procedure(s) named` }
        : {
            outcome: "empty",
            detail: "no names (no wit section, or none paired), stored {}",
          };
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
    return { outcome: "failed", detail: await errorOf(response) };
  }
};

const pendingResponse = await fetch(
  `${REGISTRY_URL}/admin/parameters/pending`,
  { headers },
);
if (!pendingResponse.ok) {
  console.error(`listing failed: ${await errorOf(pendingResponse)}`);
  process.exit(1);
}
const pending = (await pendingResponse.json()) as PendingPackage[];
console.info(`${pending.length} package(s) without parameters`);

const summary: Record<Outcome, number> = {
  named: 0,
  empty: 0,
  unreadable: 0,
  failed: 0,
};
for (const dbPackage of pending) {
  console.info(`${dbPackage.name} ${dbPackage.commitment}`);
  const { outcome, detail } = await backfill(dbPackage).catch(
    (error: unknown) => ({
      outcome: "failed" as const,
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
  summary[outcome]++;
  console.info(`  ${outcome}: ${detail}`);
}
console.info(
  `named ${summary.named}, {} with no names (mostly no wit section) ${summary.empty}, ` +
    `{} for an unreadable WIT ${summary.unreadable}, failed ${summary.failed}`,
);
process.exitCode = summary.failed > 0 ? 1 : 0;
