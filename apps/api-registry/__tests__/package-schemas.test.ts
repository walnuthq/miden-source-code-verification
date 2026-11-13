import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNTER_CONTRACT_ID_1,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import type { Package } from "miden-source-code-verification-utils/api-registry";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const counterContractDir = path.resolve(
  __dirname,
  "../../api-compile/examples/counter-contract",
);

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const api = request(apiUrl);
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

// The compose stack's (see docker-compose.yml).
const adminToken = process.env.ADMIN_TOKEN ?? "dev-admin-token";

const UNKNOWN_COMMITMENT = `0x${"11".repeat(32)}`;

const COUNTER_CONTRACT_SCHEMAS = {
  storage: {
    slots: [
      {
        name: "counter_contract::counter_contract::count_map",
        description: "counter contract storage map",
        type: "map",
        keyType: "word",
        valueType: "felt",
      },
    ],
  },
};

// Like setup.ts, to set rows up the way an older registry left them.
const client = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://miden-source-code-verification:miden_source_code_verification_dev_password@localhost:5433/miden-source-code-verification",
});
beforeAll(() => client.connect());
afterAll(() => client.end());

const verifyCounterContract = async (): Promise<Package> => {
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
  return accountRes.body.verifiedAccountComponents[0].package;
};

const adminPost = (path: string) =>
  api.post(path).set("Authorization", `Bearer ${adminToken}`).send({});

const getPending = () =>
  api
    .get("/admin/schemas/pending")
    .set("Authorization", `Bearer ${adminToken}`)
    .send();

describe("package schemas", () => {
  it("stores a verified component's storage slots", async () => {
    const { schemas } = await verifyCounterContract();
    expect(schemas).toEqual(COUNTER_CONTRACT_SCHEMAS);
  });
});

describe("POST /admin/packages/:commitment/schemas", () => {
  it("rejects requests without the admin token", async () => {
    const res = await api
      .post(`/admin/packages/${UNKNOWN_COMMITMENT}/schemas`)
      .send({});
    expect(res.status).toBe(401);

    const res2 = await api
      .get("/admin/schemas/pending")
      .set("Authorization", "Bearer wrong")
      .send();
    expect(res2.status).toBe(401);
  });

  it("answers 404 for an unknown package", async () => {
    const res = await adminPost(
      `/admin/packages/${UNKNOWN_COMMITMENT}/schemas`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package not found");
  });

  it("backfills a package stored without them", async () => {
    const { commitment } = await verifyCounterContract();
    // As an older registry stored it.
    await client.query(
      "UPDATE packages SET schemas = NULL WHERE commitment = $1",
      [commitment],
    );

    const pendingRes = await getPending();
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body).toEqual([
      expect.objectContaining({ commitment, name: "counter-contract" }),
    ]);

    const res = await adminPost(`/admin/packages/${commitment}/schemas`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schemas: COUNTER_CONTRACT_SCHEMAS });

    const { rows } = await client.query(
      "SELECT schemas FROM packages WHERE commitment = $1",
      [commitment],
    );
    expect(rows).toEqual([{ schemas: COUNTER_CONTRACT_SCHEMAS }]);

    expect((await getPending()).body).toEqual([]);
  });

  it("answers what a package already has without reading it again", async () => {
    const { commitment } = await verifyCounterContract();

    const res = await adminPost(`/admin/packages/${commitment}/schemas`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schemas: COUNTER_CONTRACT_SCHEMAS });
  });
});
