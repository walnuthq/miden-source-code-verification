import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COUNTER_CONTRACT_ID,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// The fixture account, verified from the examples with `examples` as the root.
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

const UNKNOWN_COMMITMENT = `0x${"11".repeat(32)}`;

// Like setup.ts, to set rows up the way an older registry left them.
const client = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://miden-source-code-verification:miden_source_code_verification_dev_password@localhost:5433/miden-source-code-verification",
});
beforeAll(() => client.connect());
afterAll(() => client.end());

const verifyCounterContract = async () => {
  const files = await readProjectFiles(examplesDir);
  const verifyRes = await apiV1
    .post(`/${networkId}/verified-accounts`)
    .send({ accountId: COUNTER_CONTRACT_ID, files, entrypoint: "counter-contract" });
  expect(verifyRes.status).toBe(200);
  expect(verifyRes.body).toHaveProperty("verified", true);
  const accountRes = await apiV1
    .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`)
    .send();
  expect(accountRes.status).toBe(200);
  const [component] = accountRes.body.verifiedAccountComponents;
  return component;
};

const getMasp = (file: string) =>
  apiV1.get(`/${networkId}/packages/masp/${file}`).responseType("blob");

describe("debug packages", () => {
  // A MASM package's own debug build is the package itself: see
  // masm-packages.test.ts. The Rust debug builds stored before are served
  // until spec/remove-rust plan 09.
  it("names the download after the commitment for a nameless package", async () => {
    const { commitment } = (await verifyCounterContract()).package;
    await client.query("UPDATE packages SET name = '' WHERE commitment = $1", [commitment]);

    const res = await getMasp(`${commitment}.masp`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename=${commitment}.masp`);
  });

  it("names the download after the commitment for a file without a row", async () => {
    const { commitment } = (await verifyCounterContract()).package;
    // The store keeps the file; only the row goes, as for a file the
    // registry holds without a package row.
    await client.query("DELETE FROM packages WHERE commitment = $1", [commitment]);

    const res = await getMasp(`${commitment}.masp`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename=${commitment}.masp`);
  });

  it("answers 404 for a package with no debug build", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}.debug.masp`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package debug masp not found");
  });
});
