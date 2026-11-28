// Lists the verified records the registry holds for standard code, which is
// never verified (GLOSSARY.md, "Standard component" and "Standard note"):
//
// - a verified account whose packages export nothing but procedures of
//   standard components (`standardComponentProcedures`), so none of its
//   packages accounts for custom code. The registry keeps no account's
//   procedures, so this can't tell whether the account has custom code no
//   package covers (a copy of the basic wallet verifying an account that also
//   holds a custom component is such a record, and a sound one): each record
//   listed is to be looked at, not removed as is.
// - a verified note whose script is a standard note's (`standardNotes`).
//
// Read only: one READ ONLY transaction of SELECTs, against DATABASE_URL.
// Exits 0 whatever it finds, 1 when it can't read the database.
//
//   DATABASE_URL=postgres://… pnpm --filter ./apps/api-registry find-standard-records

import {
  standardComponentProcedures,
  standardNotes,
} from "miden-source-code-verification-test-utils";
import type { Manifest } from "miden-source-code-verification-utils/manifest";
import pg from "pg";

// Only the procedures exported with the ComponentModel calling convention are
// installed as account procedures (the verifier's `verify_account_component`).
const ACCOUNT_PROCEDURE_ABI = 3;

// Each standard procedure root, with the components that hold it.
const componentsOf = new Map<string, string[]>();
for (const [name, roots] of Object.entries(standardComponentProcedures)) {
  for (const root of roots) {
    componentsOf.set(root, [...(componentsOf.get(root) ?? []), name]);
  }
}
const standardNoteOf = new Map(
  Object.entries(standardNotes).map(([name, { root }]) => [root.toLowerCase(), name]),
);

const accountProcedures = (manifest: Manifest) =>
  manifest.exports.flatMap(({ Procedure }) =>
    Procedure?.signature?.abi === ACCOUNT_PROCEDURE_ABI ? [Procedure.digest.toLowerCase()] : [],
  );

type AccountRow = {
  network_id: string;
  code: string;
  name: string;
  commitment: string;
  source: string;
  manifest: Manifest;
};
type NoteRow = { network_id: string; script: string; name: string; commitment: string };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const accounts = await client.query<AccountRow>(
    `SELECT a.network_id, a.code, p.name, p.commitment, c.source, p.manifest
       FROM verified_accounts_code a
       JOIN verified_account_components c ON c.verified_account_id = a.id
       JOIN packages p ON p.id = c.package_id
      ORDER BY a.network_id, a.code, p.name`,
  );
  const notes = await client.query<NoteRow>(
    `SELECT n.network_id, n.script, p.name, p.commitment
       FROM verified_notes_script n
       JOIN packages p ON p.id = n.package_id
      ORDER BY n.network_id, n.script`,
  );
  await client.query("ROLLBACK");

  // Each verified account, with its packages and the standard components
  // their procedures belong to; null for a package with a custom procedure.
  const records = new Map<string, { packages: string[]; standard: Set<string> | null }>();
  for (const row of accounts.rows) {
    const key = `${row.network_id} ${row.code}`;
    const record = records.get(key) ?? { packages: [], standard: new Set<string>() };
    records.set(key, record);
    record.packages.push(`${row.name} ${row.commitment} (${row.source})`);
    const procedures = accountProcedures(row.manifest);
    if (record.standard === null) {
      continue;
    }
    if (procedures.length === 0 || procedures.some((root) => !componentsOf.has(root))) {
      record.standard = null;
      continue;
    }
    for (const root of procedures) {
      for (const name of componentsOf.get(root) ?? []) {
        record.standard.add(name);
      }
    }
  }
  const standardAccounts = [...records].filter(([, { standard }]) => standard !== null);
  const standardNoteRecords = notes.rows.filter(({ script }) =>
    standardNoteOf.has(script.toLowerCase()),
  );

  console.log(
    `${records.size} verified accounts, ${standardAccounts.length} whose packages hold standard code only:`,
  );
  for (const [key, { packages, standard }] of standardAccounts) {
    console.log(`- ${key}: ${[...(standard ?? [])].join(", ")}`);
    for (const pkg of packages) {
      console.log(`    ${pkg}`);
    }
  }
  console.log(
    `${notes.rowCount} verified notes, ${standardNoteRecords.length} of a standard note's script:`,
  );
  for (const { network_id, script, name, commitment } of standardNoteRecords) {
    console.log(
      `- ${network_id} ${script}: ${standardNoteOf.get(script.toLowerCase())}, by ${name} ${commitment}`,
    );
  }
} finally {
  await client.end();
}
