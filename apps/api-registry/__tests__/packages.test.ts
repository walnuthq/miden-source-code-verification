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

// A well-formed commitment no package is ever compiled to in these tests.
const UNKNOWN_COMMITMENT = "0x1111111111111111111111111111111111111111111111111111111111111111";

// Like setup.ts, to set rows up the way an older registry left them.
const client = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://miden-source-code-verification:miden_source_code_verification_dev_password@localhost:5433/miden-source-code-verification",
});
beforeAll(() => client.connect());
afterAll(() => client.end());

// The counter fixture's package commitment, once verified.
const verifyCounterContract = async (): Promise<string> => {
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
  return accountRes.body.verifiedAccountComponents[0].package.commitment;
};

const getMasp = (file: string) =>
  apiV1.get(`/${networkId}/packages/masp/${file}`).responseType("blob");

describe("GET /:networkId/packages/masp/:packageCommitment.masp", () => {
  it("returns 404 for a commitment absent from the registry", async () => {
    const res = await apiV1.get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}.masp`).send();
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package masp not found");
  });

  it("rejects a file name that isn't a commitment", async () => {
    const res = await apiV1.get(`/${networkId}/packages/masp/counter-contract.masp`).send();
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });

  it("rejects a commitment without the .masp extension", async () => {
    const res = await apiV1.get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}`).send();
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });

  it("serves no debug build any more", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}.debug.masp`)
      .send();
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid package commitment");
  });

  it("names the download after the commitment for a nameless package", async () => {
    const commitment = await verifyCounterContract();
    await client.query("UPDATE packages SET name = '' WHERE commitment = $1", [commitment]);

    const res = await getMasp(`${commitment}.masp`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename=${commitment}.masp`);
  });

  it("names the download after the commitment for a file without a row", async () => {
    const commitment = await verifyCounterContract();
    // The store keeps the file; only the row goes, as for a file the
    // registry holds without a package row.
    await client.query("DELETE FROM packages WHERE commitment = $1", [commitment]);

    const res = await getMasp(`${commitment}.masp`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename=${commitment}.masp`);
  });
});
