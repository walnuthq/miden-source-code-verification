import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";

// These are integration tests that mutate the database (verifications insert
// rows). The assertions assume specific rows don't already exist, so we wipe the
// registry tables before every test to guarantee a clean, empty starting state.
// This makes the suite deterministic and re-runnable against the persistent
// compose database.
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://miden-source-code-verification:miden_source_code_verification_dev_password@localhost:5433/miden-source-code-verification";

// Safety guard: TRUNCATE is destructive — never let it run against a remote DB
// by accident
const { hostname } = new URL(connectionString);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
if (!localHosts.has(hostname)) {
  throw new Error(
    `Refusing to run destructive test setup against non-local database host "${hostname}". ` +
      "Point TEST_DATABASE_URL at a local/throwaway database to run these tests.",
  );
}

const client = new Client({ connectionString });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query(
    "TRUNCATE TABLE packages, verified_accounts_code, verified_account_components, verified_notes_script RESTART IDENTITY CASCADE",
  );
});
