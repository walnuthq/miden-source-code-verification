import type { VerifyResponse } from "miden-source-code-verification-utils/api-compile";
import type { ApiCompile } from "../src/lib/api-compile.ts";

// An api-compile for in-process tests, passed to `createApp` or
// `verifyResource` in place of the one over HTTP. Each call answers as set up;
// one nothing was set up for rejects, which fails the test that made it.
export const fakeApiCompile = (
  calls: Partial<ApiCompile> = {},
): ApiCompile => ({
  verify: () => Promise.reject(new Error("verify was not expected")),
  importResource: () =>
    Promise.reject(new Error("importResource was not expected")),
  ...calls,
});

// What `/verify` answers for a MASM project that verified, without its
// `root`: the assembler's `builtWith` and `diagnostics` where a Rust answer
// has `cargoMidenVersion`, no `storage` or `noteStorage`, and the files as
// sent (`spec/remove-rust/README.md`, "The MASM wire format").
export const masmVerified = (
  files: Record<string, string>,
  commitment: string,
): Omit<VerifyResponse, "root"> => ({
  verified: true,
  masp: Buffer.from("masm package").toString("base64"),
  commitment,
  kind: "account-component",
  manifest: { exports: [], dependencies: [] },
  readOnly: { "::counter_contract::increment_count": false },
  callsForeign: { "::counter_contract::increment_count": false },
  parameters: {
    "::counter_contract::increment_count": [{ name: "amount", type: "felt" }],
  },
  files,
  diagnostics: [],
  builtWith: "miden-assembly 0.36.5, miden-protocol 0.18.0",
});
