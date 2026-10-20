import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accounts,
  COUNTER_CONTRACT_ID_1,
  readProjectFiles,
} from "miden-source-code-verification-test-utils";
import { Client } from "pg";
import request from "supertest";
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

const ACCOUNT_CODE = accounts[COUNTER_CONTRACT_ID_1].code;

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
  const [component] = accountRes.body.verifiedAccountComponents;
  return component;
};

const getMasp = (file: string) =>
  apiV1.get(`/${networkId}/packages/masp/${file}`).responseType("blob");

describe("debug packages", () => {
  it("stores a verified component's debug build and serves it", async () => {
    const component = await verifyCounterContract();
    const { commitment, debugCommitment } = component.package;

    expect(debugCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(debugCommitment).not.toBe(commitment);
    expect(component).toHaveProperty("debugPackage", {
      commitment: debugCommitment,
    });
    expect(component.package).toHaveProperty("entrypoint", ".");
    expect(component.package.builtWith).toMatch(/^\d+\.\d+\.\d+$/);

    const debugRes = await getMasp(`${commitment}.debug.masp`);
    expect(debugRes.status).toBe(200);
    expect(debugRes.headers["content-type"]).toBe("application/octet-stream");
    expect(debugRes.headers["x-debug-commitment"]).toBe(debugCommitment);
    expect(debugRes.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(debugRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_contract.debug.masp",
    );

    // The release file name still answers the release build.
    const releaseRes = await getMasp(`${commitment}.masp`);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.headers).not.toHaveProperty("x-debug-commitment");
    expect(releaseRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_contract.masp",
    );
    expect(debugRes.body.length).toBeGreaterThan(releaseRes.body.length);

    // The code-keyed lookup carries it too.
    const codeRes = await apiV1
      .get(`/${networkId}/verified-accounts/code/${ACCOUNT_CODE}`)
      .send();
    expect(codeRes.status).toBe(200);
    expect(codeRes.body.verifiedAccountComponents[0]).toHaveProperty(
      "debugPackage",
      { commitment: debugCommitment },
    );
  });

  it("names the download after the commitment for a nameless package", async () => {
    const { commitment } = (await verifyCounterContract()).package;
    await client.query("UPDATE packages SET name = '' WHERE commitment = $1", [
      commitment,
    ]);

    for (const file of [`${commitment}.masp`, `${commitment}.debug.masp`]) {
      const res = await getMasp(file);
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toBe(
        `attachment; filename=${file}`,
      );
    }
  });

  it("names the download after the commitment for a file without a row", async () => {
    const { commitment } = (await verifyCounterContract()).package;
    // The store keeps the file; only the row goes, as for a file the
    // registry holds without a package row.
    await client.query("DELETE FROM packages WHERE commitment = $1", [
      commitment,
    ]);

    const res = await getMasp(`${commitment}.masp`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename=${commitment}.masp`,
    );
  });

  it("answers 404 for a package with no debug build", async () => {
    const res = await apiV1
      .get(`/${networkId}/packages/masp/${UNKNOWN_COMMITMENT}.debug.masp`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "package debug masp not found");
  });
});

describe("POST /admin/packages/:commitment/debug-build", () => {
  it("rejects requests without the admin token", async () => {
    const res = await api
      .post(`/admin/packages/${UNKNOWN_COMMITMENT}/debug-build`)
      .send();
    expect(res.status).toBe(401);

    const res2 = await api
      .get("/admin/debug-builds/pending")
      .set("Authorization", "Bearer wrong")
      .send();
    expect(res2.status).toBe(401);
  });

  it("answers 404 for an unknown package", async () => {
    const res = await api
      .post(`/admin/packages/${UNKNOWN_COMMITMENT}/debug-build`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("backfills a package stored without a debug build", async () => {
    const { package: dbPackage } = await verifyCounterContract();
    const { commitment, debugCommitment } = dbPackage;
    // As an older registry stored it: no debug build, no entrypoint.
    await client.query(
      "UPDATE packages SET debug_commitment = NULL, debug_built_with = NULL, entrypoint = NULL WHERE commitment = $1",
      [commitment],
    );

    const pendingRes = await api
      .get("/admin/debug-builds/pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body).toEqual([
      expect.objectContaining({ commitment, entrypoint: null }),
    ]);
    expect((await getMasp(`${commitment}.debug.masp`)).status).toBe(404);

    const res = await api
      .post(`/admin/packages/${commitment}/debug-build`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(200);
    // Debug builds are deterministic in code, so in commitment.
    expect(res.body).toHaveProperty("debugCommitment", debugCommitment);

    const { rows } = await client.query(
      "SELECT debug_commitment, entrypoint FROM packages WHERE commitment = $1",
      [commitment],
    );
    expect(rows).toEqual([
      { debug_commitment: debugCommitment, entrypoint: "." },
    ]);
    expect((await getMasp(`${commitment}.debug.masp`)).status).toBe(200);
  });

  it("skips a package the toolchain no longer reproduces", async () => {
    const { package: dbPackage } = await verifyCounterContract();
    const { commitment } = dbPackage;
    // Sources that build to another commitment, as after a toolchain change.
    await client.query(
      `UPDATE packages
       SET debug_commitment = NULL,
           files = jsonb_set(files, '{src/lib.rs}', to_jsonb(replace(
             files->>'src/lib.rs',
             'current_value + felt!(1)',
             'current_value + felt!(2)'
           )))
       WHERE commitment = $1`,
      [commitment],
    );

    const res = await api
      .post(`/admin/packages/${commitment}/debug-build`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty(
      "error",
      "toolchain no longer reproduces this package",
    );
  });
});
