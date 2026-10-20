import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectFiles } from "miden-source-code-verification-test-utils";
import {
  type Manifest,
  procedureExportPaths,
} from "miden-source-code-verification-utils/manifest";
import request from "supertest";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const counterContractDir = path.resolve(
  __dirname,
  "../examples/counter-contract",
);
const bankDir = path.resolve(__dirname, "../examples/miden-bank");

const api = request(process.env.API_URL ?? "http://localhost:8080");

const readCounterContract = () =>
  readProjectFiles(`${counterContractDir}/counter-contract`);

// A debug build has other roots, so it can only be paired with its release
// build by export path.
const expectDebugBuildOf = (
  debug: {
    masp: string;
    commitment: string;
    manifest: Manifest;
    cargoMidenVersion: string;
  },
  release: { commitment: string; manifest: Manifest },
) => {
  expect(debug.commitment).toMatch(/^0x[0-9a-f]{64}$/);
  expect(debug.commitment).not.toBe(release.commitment);
  expect(debug.cargoMidenVersion).toMatch(/^\d+\.\d+\.\d+$/);
  // Debug info makes it far larger than the release build.
  expect(Buffer.from(debug.masp, "base64").length).toBeGreaterThan(100_000);
  const debugPaths = procedureExportPaths(debug.manifest);
  for (const exportPath of procedureExportPaths(release.manifest)) {
    expect(debugPaths).toContain(exportPath);
  }
};

describe("POST /compile with debug", () => {
  it("builds the debug variant of a counter-contract", async () => {
    const files = await readCounterContract();

    const res = await api.post("/compile").send({ files, debug: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).toHaveProperty("debug");
    expectDebugBuildOf(res.body.debug, res.body);
  });

  it("doesn't build it unless asked", async () => {
    const files = await readCounterContract();

    const res = await api.post("/compile").send({ files });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("commitment");
    expect(res.body).not.toHaveProperty("debug");
  });

  // bank-account's `withdraw` only builds in debug thanks to a local change
  // from upstream (see `create_p2id_note`), which this guards.
  it("builds the debug variant of a bank-account", async () => {
    const files = await readProjectFiles(`${bankDir}/bank-account`);

    const res = await api.post("/compile").send({ files, debug: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("commitment");
    expect(res.body.debug).not.toHaveProperty("error");
    expectDebugBuildOf(res.body.debug, res.body);
  });
});

describe("POST /compile-debug", () => {
  it("rejects requests with no expectedCommitment", async () => {
    const files = await readCounterContract();

    const res = await api.post("/compile-debug").send({ files });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing expectedCommitment");
  });

  it("builds the debug variant when the release build reproduces", async () => {
    const files = await readCounterContract();
    const release = await api.post("/compile").send({ files });
    expect(release.status).toBe(200);

    const res = await api
      .post("/compile-debug")
      .send({ files, expectedCommitment: release.body.commitment });

    expect(res.status).toBe(200);
    expectDebugBuildOf(res.body.debug, release.body);
  });

  it("answers 409 when the release build doesn't reproduce", async () => {
    const files = await readCounterContract();

    const res = await api.post("/compile-debug").send({
      files,
      expectedCommitment: `0x${"11".repeat(32)}`,
    });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty(
      "error",
      "toolchain no longer reproduces this package",
    );
  });
});
