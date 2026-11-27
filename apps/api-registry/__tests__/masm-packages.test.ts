import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  editProjectFile,
  COUNTER_CONTRACT_ID,
  COUNTER_NOTE_ID,
  accounts,
  notes,
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import type {
  Package,
  VerifiedAccountComponent,
} from "miden-source-code-verification-utils/api-registry";
import { describe, expect, it } from "vitest";

// The fixtures, deployed by `pnpm generate-fixtures` from the
// projects in `examples`. The note's project depends on
// `../counter-contract`, so both are sent with `examples` as the root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const masmDir = path.resolve(__dirname, "../../api-compile/examples");

const apiUrl = process.env.API_URL ?? "http://localhost:8081";
const apiV1 = request(`${apiUrl}/v1`);

const networkId = process.env.NETWORK_ID ?? "mtst";

// Verifies a fixture with the project in `examples` at `entrypoint`, and
// returns the files sent.
const verifyMasm = async (
  route: "verified-accounts" | "verified-notes",
  resource: { accountId: string } | { noteId: string },
  entrypoint: string,
) => {
  const files = await readProjectFiles(masmDir);
  const res = await apiV1.post(`/${networkId}/${route}`).send({ ...resource, files, entrypoint });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ verified: true });
  return files;
};

const verifyCounterContract = () =>
  verifyMasm("verified-accounts", { accountId: COUNTER_CONTRACT_ID }, "counter-contract");

const verifyCounterNote = () =>
  verifyMasm("verified-notes", { noteId: COUNTER_NOTE_ID }, "counter-note");

const getMasp = (file: string) =>
  apiV1.get(`/${networkId}/packages/masp/${file}`).responseType("blob");

// What every package's row holds: the assembler's versions, and neither a
// debug build nor storage schemas on the wire.
const expectMasmPackage = (pkg: Package, files: Record<string, string>) => {
  expect(pkg.builtWith).toMatch(/^miden-assembly \d+\.\d+\.\d+, /);
  expect(pkg).not.toHaveProperty("debugCommitment");
  expect(pkg).not.toHaveProperty("debugBuiltWith");
  expect(pkg).not.toHaveProperty("schemas");
  // Stored as sent: a MASM project has no lockfile to add.
  expect(pkg.files).toEqual(files);
};

describe("a MASM account component", () => {
  it("verifies and is recorded", async () => {
    const files = await verifyCounterContract();

    const res = await apiV1.get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`).send();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("code", accounts[COUNTER_CONTRACT_ID].code);
    const components: VerifiedAccountComponent[] = res.body.verifiedAccountComponents;
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
        "::counter_contract::increment_count": [expect.objectContaining({ name: "amount" })],
      }),
    );
    expect(component).not.toHaveProperty("debugPackage");
  });

  it("serves its package as .masp, and no .debug.masp", async () => {
    await verifyCounterContract();
    const accountRes = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`)
      .send();
    const { commitment } = accountRes.body.verifiedAccountComponents[0].package;

    const releaseRes = await getMasp(`${commitment}.masp`);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.headers).not.toHaveProperty("x-debug-commitment");
    expect(releaseRes.headers["content-disposition"]).toBe(
      "attachment; filename=counter_contract.masp",
    );

    const debugRes = await apiV1.get(`/${networkId}/packages/masp/${commitment}.debug.masp`).send();
    expect(debugRes.status).toBe(400);
    expect(debugRes.body).toEqual({ error: "invalid package commitment" });
  });

  it("doesn't verify with a changed constant, and records nothing", async () => {
    const files = await readProjectFiles(masmDir);
    editProjectFile(files, "counter-contract/counter_contract.masm", (source) =>
      source.replace('word("counter_contract::count")', 'word("counter_contract::other_count")'),
    );
    const res = await apiV1.post(`/${networkId}/verified-accounts`).send({
      accountId: COUNTER_CONTRACT_ID,
      files,
      entrypoint: "counter-contract",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: false });

    const accountRes = await apiV1
      .get(`/${networkId}/verified-accounts/${COUNTER_CONTRACT_ID}`)
      .send();
    expect(accountRes.status).toBe(404);
  });
});

describe("a MASM note with a path dependency", () => {
  it("verifies and is recorded", async () => {
    const files = await verifyCounterNote();

    const res = await apiV1.get(`/${networkId}/verified-notes/${COUNTER_NOTE_ID}`).send();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("script", notes[COUNTER_NOTE_ID].code);
    const pkg: Package = res.body.package;
    expect(pkg).toMatchObject({
      name: "counter-note",
      type: "note",
      entrypoint: "counter-note",
      parameters: { "::counter_note::main": [] },
    });
    expectMasmPackage(pkg, files);

    const maspRes = await getMasp(`${pkg.commitment}.masp`);
    expect(maspRes.status).toBe(200);
    expect(maspRes.headers["content-disposition"]).toBe("attachment; filename=counter_note.masp");
  });
});
