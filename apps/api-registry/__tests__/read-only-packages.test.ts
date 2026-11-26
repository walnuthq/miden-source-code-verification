import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COUNTER_CONTRACT_ID,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { describe, expect, it } from "vitest";

// The fixture account, verified from the examples with `examples` as the root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, "../../api-compile/examples");

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

const COUNTER_CONTRACT_READ_ONLY = {
  "::counter_contract::get_count": true,
  "::counter_contract::increment_count": false,
};

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
  const [{ package: dbPackage }] = accountRes.body.verifiedAccountComponents;
  return dbPackage as {
    commitment: string;
    readOnly: Record<string, boolean | null>;
    parameters: Record<string, { name: string; type: string }[]>;
  };
};

describe("read-only procedures", () => {
  it("stores whether a verified component's procedures are read-only", async () => {
    const { readOnly } = await verifyCounterContract();
    expect(readOnly).toEqual(COUNTER_CONTRACT_READ_ONLY);
  });

  it("stores the names of its procedures' parameters, from the source", async () => {
    const { parameters } = await verifyCounterContract();
    expect(parameters).toEqual({
      "::counter_contract::get_count": [],
      "::counter_contract::increment_count": [{ name: "amount", type: "felt" }],
    });
  });
});
