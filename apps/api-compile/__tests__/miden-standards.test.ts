import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  accounts,
  COUNTER_CONTRACT_ID,
  readProjectFiles,
  request,
  standardComponents,
  standardNotes,
  standardsLibrary,
} from "miden-source-code-verification-test-utils";
import { beforeAll, describe, expect, it } from "vitest";

// `/compile` and `/verify` on `miden-standards`, the verbatim copy of the
// crate's MASM, against the offline accounts and notes `standard-fixtures`
// builds from the packages the crate ships. Each standard component and note
// must verify from its own source even though the verifier also recognises it
// as standard: being recognised names it, it doesn't verify it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const standardsDir = path.resolve(__dirname, "../miden-standards");

const api = request(process.env.API_URL ?? "http://localhost:8080");

const networkId = process.env.NETWORK_ID ?? "mtst";

const basicWallet = standardComponents["miden-standards-wallets-basic-wallet"];

// The files of one of the copy's two projects, keyed by their path in the
// copy: the components workspace needs every member, the library every module.
let componentFiles: Record<string, string>;
let libraryFiles: Record<string, string>;

beforeAll(async () => {
  const files = await readProjectFiles(standardsDir);
  const under = (prefix: string) =>
    Object.fromEntries(Object.entries(files).filter(([file]) => file.startsWith(prefix)));
  componentFiles = under("asm/components/");
  libraryFiles = under("asm/standards/");
});

describe("the copy of miden-standards", () => {
  it("compiles the standards library to the one the crate ships", async () => {
    const res = await api
      .post("/compile")
      .send({ files: libraryFiles, entrypoint: standardsLibrary.entrypoint });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("built", true);
    expect(res.body).toHaveProperty("kind", "library");
    expect(res.body).toHaveProperty("commitment", standardsLibrary.commitment);
    expect(res.body).toHaveProperty("diagnostics", []);
  });

  it("is the library the server links", async () => {
    // A copy left behind by a bump of the crate compiles to another library
    // than the one the server's assembler resolves `miden-standards` to.
    const res = await api
      .post("/compile")
      .send({ files: componentFiles, entrypoint: basicWallet.entrypoint });

    expect(res.status).toBe(200);
    expect(res.body.manifest.dependencies).toContainEqual(
      expect.objectContaining({ name: "miden-standards", digest: standardsLibrary.commitment }),
    );
  });

  it("names the basic wallet's parameters from the library's source", async () => {
    const res = await api
      .post("/compile")
      .send({ files: libraryFiles, entrypoint: standardsLibrary.entrypoint });

    expect(res.status).toBe(200);
    expect(res.body.parameters).toMatchObject({
      "::miden::standards::wallets::basic::move_asset_to_note": [
        { name: "asset", type: "Asset" },
        { name: "note_idx", type: "u16" },
      ],
      "::miden::standards::wallets::basic::receive_asset": [{ name: "asset", type: "Asset" }],
    });
  });
});

describe("POST /verify a standard account component", () => {
  it.each(Object.entries(standardComponents))(
    "verifies %s from its source",
    async (_, { entrypoint, commitment, accountId, code, resource }) => {
      const res = await api.post("/verify").send({
        files: componentFiles,
        entrypoint,
        networkId,
        resourceId: accountId,
        resource,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("verified", true);
      expect(res.body).toHaveProperty("root", code);
      expect(res.body).toHaveProperty("commitment", commitment);
    },
  );

  it("verifies the basic wallet in an account with custom code too", async () => {
    // The counter fixture: the counter component, `NoAuth` and `BasicWallet`.
    const { resource } = accounts[COUNTER_CONTRACT_ID];
    const res = await api.post("/verify").send({
      files: componentFiles,
      entrypoint: basicWallet.entrypoint,
      networkId,
      resourceId: COUNTER_CONTRACT_ID,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", true);
  });

  it("doesn't verify a standard account with another component", async () => {
    const res = await api.post("/verify").send({
      files: componentFiles,
      entrypoint: standardComponents["miden-standards-access-ownable2step"].entrypoint,
      networkId,
      resourceId: basicWallet.accountId,
      resource: basicWallet.resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
    expect(res.body).toHaveProperty("root", basicWallet.code);
  });

  it("doesn't verify a standard account with the standards library", async () => {
    const res = await api.post("/verify").send({
      files: libraryFiles,
      entrypoint: standardsLibrary.entrypoint,
      networkId,
      resourceId: basicWallet.accountId,
      resource: basicWallet.resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
  });
});

describe("POST /verify a standard note", () => {
  it.each(Object.entries(standardNotes))(
    "verifies %s with the standards library",
    async (_, { noteId, root, resource }) => {
      const res = await api.post("/verify").send({
        files: libraryFiles,
        entrypoint: standardsLibrary.entrypoint,
        networkId,
        resourceId: noteId,
        resource,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("verified", true);
      expect(res.body).toHaveProperty("root", root);
      expect(res.body).toHaveProperty("commitment", standardsLibrary.commitment);
    },
  );

  it("doesn't verify a standard note with a component", async () => {
    const { noteId, root, resource } = standardNotes.P2ID;
    const res = await api.post("/verify").send({
      files: componentFiles,
      entrypoint: basicWallet.entrypoint,
      networkId,
      resourceId: noteId,
      resource,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verified", false);
    expect(res.body).toHaveProperty("root", root);
  });
});
