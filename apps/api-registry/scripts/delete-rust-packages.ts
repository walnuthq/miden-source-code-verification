// Deletes the Rust-built packages, the verified accounts and notes that point
// at them, and their stored files, through the registry's `/admin` routes
// (`spec/remove-rust`, decision 6). There is no undo short of a database
// restore.
//
//   REGISTRY_URL=https://… ADMIN_TOKEN=… \
//     pnpm --filter miden-source-code-verification-api-registry \
//     exec node --conditions development --env-file-if-exists=.env scripts/delete-rust-packages.ts [--report=<file>] [--apply]
//
// Without `--apply` it is a dry run: it prints what would go, per network, and
// deletes nothing. `--report=<file>` writes the full listing (every package,
// account, note and file key) as JSON. With `--apply` it deletes in batches
// until none is left, then lists again, and exits non-zero unless the listing
// is empty. Safe to run twice: a second run finds nothing.
import { writeFile } from "node:fs/promises";

import type { RustPackagesDeletion, RustPackagesReport } from "../src/lib/rust-packages.ts";

const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8081";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const APPLY = process.argv.includes("--apply");
const REPORT_FILE = process.argv
  .find((argument) => argument.startsWith("--report="))
  ?.slice("--report=".length);

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

const errorOf = async (response: Response) => {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? `HTTP ${response.status}`;
};

const list = async (): Promise<RustPackagesReport> => {
  const response = await fetch(`${REGISTRY_URL}/admin/rust-packages`, { headers });
  if (!response.ok) {
    console.error(`listing failed: ${await errorOf(response)}`);
    process.exit(1);
  }
  return (await response.json()) as RustPackagesReport;
};

const print = ({ networks, counts }: RustPackagesReport) => {
  console.info(
    `${counts.packages} Rust package(s), ${counts.verifiedAccounts} verified account(s), ` +
      `${counts.verifiedNotes} verified note(s), ${counts.files} file(s)`,
  );
  for (const [networkId, report] of Object.entries(networks).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.info(
      `  ${networkId}: ${report.packages.length} package(s), ` +
        `${report.verifiedAccounts.length} account(s), ${report.verifiedNotes.length} note(s)`,
    );
    for (const code of report.mixedAccounts) {
      console.info(`    ${code} also has a MASM component, which goes with it`);
    }
  }
};

const before = await list();
console.info(`${APPLY ? "Deleting" : "Dry run, nothing deleted"}: ${REGISTRY_URL}`);
print(before);
if (REPORT_FILE) {
  await writeFile(REPORT_FILE, `${JSON.stringify(before, null, 2)}\n`);
  console.info(`listing written to ${REPORT_FILE}`);
}
if (!APPLY) {
  process.exit(0);
}

const total = { packages: 0, verifiedAccounts: 0, verifiedNotes: 0 };
for (;;) {
  const response = await fetch(`${REGISTRY_URL}/admin/rust-packages/delete`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!response.ok) {
    console.error(`deletion failed: ${await errorOf(response)}`);
    process.exit(1);
  }
  const batch = (await response.json()) as RustPackagesDeletion;
  total.packages += batch.packages;
  total.verifiedAccounts += batch.verifiedAccounts;
  total.verifiedNotes += batch.verifiedNotes;
  console.info(
    `  deleted ${batch.packages} package(s), ${batch.verifiedAccounts} account(s), ` +
      `${batch.verifiedNotes} note(s); ${batch.remaining} left`,
  );
  if (batch.remaining === 0 || batch.packages === 0) {
    break;
  }
}
console.info(
  `Deleted ${total.packages} package(s), ${total.verifiedAccounts} verified account(s), ` +
    `${total.verifiedNotes} verified note(s)`,
);

const after = await list();
print(after);
if (after.counts.packages > 0) {
  console.error("Rust packages are left");
  process.exit(1);
}
