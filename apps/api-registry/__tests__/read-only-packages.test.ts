import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNTER_CONTRACT_ID_1,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const counterContractDir = path.resolve(
  __dirname,
  "../../api-compile/examples/counter-contract",
);

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

const component = '::"miden:counter-contract/counter-contract@0.1.0"';
const COUNTER_CONTRACT_READ_ONLY = {
  [`${component}::"get-count"`]: true,
  [`${component}::"increment-count"`]: false,
  [`${component}::init`]: true,
};

const verifyCounterContract = async () => {
  const files = await readProjectFiles(
    `${counterContractDir}/counter-contract`,
  );
  const verifyRes = await apiV1
    .post(`/${networkId}/verified-accounts`)
    .send({ accountId: COUNTER_CONTRACT_ID_1, files });
  expect(verifyRes.status).toBe(200);
  expect(verifyRes.body).toHaveProperty("verified", true);
  const accountRes = await apiV1
    .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID_1}`)
    .send();
  expect(accountRes.status).toBe(200);
  const [{ package: dbPackage }] = accountRes.body.verifiedAccountComponents;
  return dbPackage as {
    commitment: string;
    readOnly: Record<string, boolean | null>;
  };
};

describe("read-only procedures", () => {
  it("stores whether a verified component's procedures are read-only", async () => {
    const { readOnly } = await verifyCounterContract();
    expect(readOnly).toEqual(COUNTER_CONTRACT_READ_ONLY);
  });
});
