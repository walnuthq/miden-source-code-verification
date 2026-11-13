import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readProjectFiles,
  request,
} from "miden-source-code-verification-test-utils";
import type { CompileResponse } from "miden-source-code-verification-utils/api-compile";
import { beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const counterContractDir = path.resolve(
  __dirname,
  "../examples/counter-contract",
);

const api = request(process.env.API_URL ?? "http://localhost:8080");

describe("POST /package-metadata", () => {
  // The counter-contract as `/compile` builds and reads it.
  let compiled: Extract<CompileResponse, { built: true }>;
  beforeAll(async () => {
    const files = await readProjectFiles(
      `${counterContractDir}/counter-contract`,
    );
    const res = await api.post("/compile").send({ files });
    expect(res.status).toBe(200);
    compiled = res.body;
  });

  it("reads a package's metadata as /compile does, without building it", async () => {
    const res = await api
      .post("/package-metadata")
      .send(Buffer.from(compiled.masp, "base64"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      commitment: compiled.commitment,
      kind: compiled.kind,
      manifest: compiled.manifest,
      readOnly: compiled.readOnly,
      storage: compiled.storage,
    });
    expect(res.body.storage.slots).toHaveLength(1);
  });

  it("rejects a request without a masp", async () => {
    const res = await api.post("/package-metadata").send(new Uint8Array());

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing masp");
  });

  it("rejects bytes that aren't a package", async () => {
    const res = await api
      .post("/package-metadata")
      .send(Buffer.from("not a package"));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failed to parse package/);
  });
});
