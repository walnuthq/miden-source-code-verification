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
// builds from the packages the crate ships. The copy compiles to exactly what
// the crate ships, but standard code is never verified: an account of standard
// components alone, or a standard note, has no verified record, whatever
// package is sent. A standard component in an account with custom code is
// accounted for by the package that verifies the account, as any procedure.

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
  const filesUnder = (prefix: string) =>
    Object.fromEntries(Object.entries(files).filter(([file]) => file.startsWith(prefix)));
  componentFiles = filesUnder("asm/components/");
  libraryFiles = filesUnder("asm/standards/");
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
    // Named from the library's source: the components only re-export them.
    expect(res.body.parameters).toMatchObject({
      "::miden::standards::wallets::basic::move_asset_to_note": [
        { name: "asset", type: "Asset" },
        { name: "note_idx", type: "u16" },
      ],
      "::miden::standards::wallets::basic::receive_asset": [{ name: "asset", type: "Asset" }],
    });
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
});

describe("a standard account component", () => {
  it.each(Object.entries(standardComponents))(
    "compiles %s to the package the crate ships",
    async (_, { entrypoint, commitment }) => {
      const res = await api.post("/compile").send({ files: componentFiles, entrypoint });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("built", true);
      expect(res.body).toHaveProperty("commitment", commitment);
    },
  );

  it.each(Object.entries(standardComponents))(
    "doesn't verify an account of standard components alone with %s",
    async (_, { entrypoint, accountId, code, resource }) => {
      const res = await api.post("/verify").send({
        files: componentFiles,
        entrypoint,
        networkId,
        resourceId: accountId,
        resource,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("verified", false);
      expect(res.body).toHaveProperty("root", code);
    },
  );

  it("verifies the basic wallet in an account with custom code", async () => {
    // The counter fixture: the counter component, `NoAuth` and `BasicWallet`.
    // The wallet's package accounts for every procedure it exports, as the
    // counter's package would for its own.
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
});

describe("a standard note", () => {
  it("is a note script of the standards library, at its root", async () => {
    // A note script's root depends on what else the forest it is assembled in
    // holds, so it is compiled where the crate compiles it.
    const res = await api
      .post("/compile")
      .send({ files: libraryFiles, entrypoint: standardsLibrary.entrypoint });

    expect(res.status).toBe(200);
    const exports = new Map(
      res.body.manifest.exports.flatMap(
        ({ Procedure }: { Procedure?: { path: string; digest: string } }) =>
          Procedure ? [[Procedure.path, Procedure.digest]] : [],
      ),
    );
    for (const { path: procedurePath, root } of Object.values(standardNotes)) {
      expect(exports.get(procedurePath), procedurePath).toBe(root);
    }
  });

  it.each(Object.entries(standardNotes))(
    "doesn't verify %s with the standards library",
    async (_, { noteId, root, resource }) => {
      const res = await api.post("/verify").send({
        files: libraryFiles,
        entrypoint: standardsLibrary.entrypoint,
        networkId,
        resourceId: noteId,
        resource,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("verified", false);
      expect(res.body).toHaveProperty("root", root);
    },
  );
});
