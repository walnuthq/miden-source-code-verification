import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  editProjectFile,
  MASM_COUNTER_CONTRACT_ID,
  MASM_COUNTER_NOTE_ID,
  masmAccounts,
  masmNotes,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import type {
  Package,
  VerifiedAccountComponent,
} from "miden-source-code-verification-utils/api-registry";
import { describe, expect, it } from "vitest";

// The MASM fixtures, deployed by `generate-fixtures --mode masm` from the
// projects in `examples/masm`. The note's project depends on
// `../counter-contract`, so both are sent with `examples/masm` as the root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const masmDir = path.resolve(__dirname, "../../api-compile/examples/masm");

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

const verifyCounterContract = async () => {
  const files = await readProjectFiles(masmDir);
  const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
    accountId: MASM_COUNTER_CONTRACT_ID,
    files,
    entrypoint: "counter-contract",
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ verified: true });
  return files;
};

const verifyCounterNote = async () => {
  const files = await readProjectFiles(masmDir);
  const res = await apiV1.post(`/${networkId}/verified-notes`).send({
    noteId: MASM_COUNTER_NOTE_ID,
    files,
    entrypoint: "counter-note",
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ verified: true });
  return files;
};

const getMasp = (file: string) =>
  apiV1.get(`/${networkId}/packages/masp/${file}`).responseType("blob");

// What every MASM package's row holds in place of a Rust one's: the
// assembler's versions, no debug build of its own and no schemas.
const expectMasmPackage = (pkg: Package, files: Record<string, string>) => {
  expect(pkg.builtWith).toMatch(/^miden-assembly \d+\.\d+\.\d+, /);
  expect(pkg.debugCommitment).toBeNull();
  expect(pkg.debugBuiltWith).toBeNull();
  expect(pkg.schemas).toEqual({});
  // Stored as sent: a MASM project has no lockfile to add.
  expect(pkg.files).toEqual(files);
};

describe("a MASM account component", () => {
  it("verifies and is recorded", async () => {
    const files = await verifyCounterContract();

    const res = await apiV1
      .get(`/${networkId}/verified-accounts/${MASM_COUNTER_CONTRACT_ID}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty(
      "code",
      masmAccounts[MASM_COUNTER_CONTRACT_ID].code,
    );
    const components: VerifiedAccountComponent[] =
      res.body.verifiedAccountComponents;
    expect(components).toHaveLength(1);
    const [component] = components;
    if (!component) throw new Error("no component");
    const pkg = component.package;
    expect(pkg).toMatchObject({
      name: "counter-contract",
      type: "account-component",
      entrypoint: "counter-contract",
    });
    expectMasmPackage(pkg, files);
    expect(pkg.parameters).toEqual(
      expect.objectContaining({
        "::counter_contract::increment_count": [
          expect.objectContaining({ name: "amount" }),
        ],
      }),
    );
    // Its debug build is the package itself.
    expect(component.debugPackage).toEqual({ commitment: pkg.commitment });
  });

  it("serves its package as both .masp and .debug.masp", async () => {
    await verifyCounterContract();
    const accountRes = await apiV1
      .get(`/${networkId}/verified-accounts/${MASM_COUNTER_CONTRACT_ID}`)
      .send();
    const { commitment } = accountRes.body.verifiedAccountComponents[0].package;

    const releaseRes = await getMasp(`${commitment}.masp`);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.headers).not.toHaveProperty("x-debug-commitment");
    expect(releaseRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_contract.masp",
    );

    const debugRes = await getMasp(`${commitment}.debug.masp`);
    expect(debugRes.status).toBe(200);
    expect(debugRes.headers["x-debug-commitment"]).toBe(commitment);
    expect(debugRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_contract.debug.masp",
    );
    expect(debugRes.body).toEqual(releaseRes.body);
  });

  it("doesn't verify with a changed constant, and records nothing", async () => {
    const files = await readProjectFiles(masmDir);
    editProjectFile(files, "counter-contract/counter_contract.masm", (source) =>
      source.replace(
        'word("counter_contract::count")',
        'word("counter_contract::other_count")',
      ),
    );
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: MASM_COUNTER_CONTRACT_ID,
      files,
      entrypoint: "counter-contract",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: false });

    const accountRes = await apiV1
      .get(`/${networkId}/verified-accounts/${MASM_COUNTER_CONTRACT_ID}`)
      .send();
    expect(accountRes.status).toBe(404);
  });
});

describe("a MASM note with a path dependency", () => {
  it("verifies and is recorded", async () => {
    const files = await verifyCounterNote();

    const res = await apiV1
      .get(`/${networkId}/verified-notes/${MASM_COUNTER_NOTE_ID}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty(
      "script",
      masmNotes[MASM_COUNTER_NOTE_ID].code,
    );
    const pkg: Package = res.body.package;
    expect(pkg).toMatchObject({
      name: "counter-note",
      type: "note",
      entrypoint: "counter-note",
      parameters: { "::counter_note::main": [] },
    });
    expectMasmPackage(pkg, files);

    const debugRes = await getMasp(`${pkg.commitment}.debug.masp`);
    expect(debugRes.status).toBe(200);
    expect(debugRes.headers["x-debug-commitment"]).toBe(pkg.commitment);
    expect(debugRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_note.debug.masp",
    );
  });
});
