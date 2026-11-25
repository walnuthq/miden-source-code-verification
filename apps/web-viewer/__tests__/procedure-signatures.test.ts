import type {
  CallConv,
  FunctionType,
  ProcedureParameters,
  ReadOnlyProcedures,
  Type,
  Word,
} from "miden-source-code-verification-utils/manifest";
import { describe, expect, it } from "vitest";

import type { PackageManifest } from "@/lib/api-registry.server";
import {
  type PackageProcedure,
  packageProcedures,
  procedureName,
} from "@/lib/procedure-signatures";

// A struct of `miden:base/core-types`, as the manifest's signatures name them.
const core = (name: string): Type => ({
  Struct: {
    name: `miden:base/core-types@1.0.0/${name}`,
    repr: "Default",
    size: 4,
    fields: [],
  },
});

type Export = [
  path: string,
  digest: Word,
  abi: CallConv,
  readOnly?: boolean | null,
  signature?: Pick<FunctionType, "params" | "results">,
];

// A manifest exporting each `[path, digest, abi, readOnly, signature]`, and its
// read-only map, as the registry serves them. `readOnly` defaults to `null`,
// the signature to none of either.
const exported = (
  ...exports: Export[]
): { manifest: PackageManifest; readOnly: ReadOnlyProcedures } => ({
  manifest: {
    exports: exports.map(
      ([
        path,
        digest,
        abi,
        ,
        { params, results } = { params: [], results: [] },
      ]) => ({
        Procedure: { path, digest, signature: { abi, params, results } },
      }),
    ),
    dependencies: [],
  },
  readOnly: Object.fromEntries(
    exports.map(([path, , , readOnly = null]) => [path, readOnly]),
  ),
});

const counterPath = (name: string) =>
  `::"miden:counter-contract/counter-contract@0.1.0"::${name}`;
const bankPath = (name: string) => `::"miden:bank-account/bank@0.1.0"::${name}`;
const notePath = '::"miden:counter-note/miden-counter-note@0.1.0"::run';

const signatures = (procedures: PackageProcedure[]) =>
  procedures.map(({ signature }) => signature);

// The bank example, as api-compile reads it: exported alphabetically, each
// with its manifest signature and the names its WIT gives.
const bank = {
  ...exported(
    [
      bankPath('"get-depositor-balance"'),
      "0x01",
      3,
      true,
      { params: [core("account-id"), core("asset")], results: [core("felt")] },
    ],
    [
      bankPath("deposit"),
      "0x02",
      3,
      false,
      { params: [core("account-id"), core("asset")], results: [] },
    ],
    [bankPath("initialize"), "0x03", 3, false],
    [
      bankPath("withdraw"),
      "0x04",
      3,
      false,
      {
        params: [core("asset"), core("word"), core("felt"), core("felt")],
        results: [],
      },
    ],
  ),
};
const bankParameters: ProcedureParameters = {
  [bankPath('"get-depositor-balance"')]: [
    { name: "depositor", type: "account-id" },
    { name: "asset", type: "asset" },
  ],
  [bankPath("deposit")]: [
    { name: "depositor", type: "account-id" },
    { name: "deposit-asset", type: "asset" },
  ],
  [bankPath("initialize")]: [],
  [bankPath("withdraw")]: [
    { name: "withdraw-asset", type: "asset" },
    { name: "serial-num", type: "word" },
    { name: "tag", type: "felt" },
    { name: "note-type", type: "felt" },
  ],
};

describe("procedureName", () => {
  it("takes the last path segment, unquoted, snake-cased", () => {
    expect(procedureName(counterPath('"get-count"'))).toBe("get_count");
    expect(procedureName(notePath)).toBe("run");
  });
});

describe("packageProcedures of a Rust package", () => {
  describe("with the WIT's names", () => {
    it("writes each signature from the names and the manifest's types, in manifest order", () => {
      const procedures = packageProcedures({
        kind: "rust",
        ...bank,
        parameters: bankParameters,
      });
      expect(procedures).toEqual([
        {
          name: "get_depositor_balance",
          signature:
            "fn get_depositor_balance(depositor: AccountId, asset: Asset) -> Felt;",
          digest: "0x01",
          readOnly: true,
        },
        {
          name: "deposit",
          signature: "fn deposit(depositor: AccountId, deposit_asset: Asset);",
          digest: "0x02",
          readOnly: false,
        },
        {
          name: "initialize",
          signature: "fn initialize();",
          digest: "0x03",
          readOnly: false,
        },
        {
          name: "withdraw",
          signature:
            "fn withdraw(withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);",
          digest: "0x04",
          readOnly: false,
        },
      ]);
    });

    it("writes a note's entrypoint with only the argument it is given", () => {
      const procedures = packageProcedures({
        kind: "rust",
        ...exported([
          notePath,
          "0x01",
          3,
          null,
          { params: [core("word")], results: [] },
        ]),
        parameters: { [notePath]: [{ name: "arg", type: "word" }] },
      });
      expect(signatures(procedures)).toEqual(["fn run(arg: Word);"]);
    });

    it("writes Rust's integers, arrays, lists, and a type the manifest leaves unnamed", () => {
      const path = counterPath("mix");
      const procedures = packageProcedures({
        kind: "rust",
        ...exported([
          path,
          "0x01",
          3,
          null,
          {
            params: [
              "U64",
              "I1",
              { Array: { ty: "Felt", len: 4 } },
              { List: "U8" },
              { Struct: { name: null, repr: "Default", size: 8, fields: [] } },
            ],
            results: ["U32", "Felt"],
          },
        ]),
        parameters: {
          [path]: [
            { name: "amount", type: "u64" },
            { name: "flag", type: "bool" },
            { name: "slots", type: "felts" },
            { name: "bytes", type: "list" },
            { name: "pair", type: "price-pair" },
          ],
        },
      });
      expect(signatures(procedures)).toEqual([
        "fn mix(amount: u64, flag: bool, slots: [Felt; 4], bytes: Vec<u8>, pair: PricePair) -> (u32, Felt);",
      ]);
    });

    it("leaves out exports that aren't account procedures", () => {
      const procedures = packageProcedures({
        kind: "rust",
        ...exported(
          [
            counterPath('"get-count"'),
            "0x01",
            3,
            true,
            { params: [], results: [core("felt")] },
          ],
          [counterPath("init"), "0x03", 0, true],
        ),
        parameters: { [counterPath('"get-count"')]: [] },
      });
      expect(signatures(procedures)).toEqual(["fn get_count() -> Felt;"]);
    });
  });

  it("writes `_` for each parameter of an export the names leave out", () => {
    const { [bankPath("deposit")]: _, ...parameters } = bankParameters;
    const procedures = packageProcedures({
      kind: "rust",
      ...bank,
      parameters,
    });
    expect(signatures(procedures)).toEqual([
      "fn get_depositor_balance(depositor: AccountId, asset: Asset) -> Felt;",
      "fn deposit(_: AccountId, _: Asset);",
      "fn initialize();",
      "fn withdraw(withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);",
    ]);
  });
});

// The MASM examples' exports, as api-compile reads them: paths of the
// namespace and the procedure, types as the assembler records them.
const masmPath = (name: string) => `::counter_contract::${name}`;
const asset: Type = {
  Struct: {
    name: "Asset",
    repr: "Default",
    size: 32,
    fields: [
      {
        name: "id",
        index: 0,
        align: 4,
        offset: 0,
        ty: { Array: { ty: "Felt", len: 4 } },
      },
      {
        name: "value",
        index: 1,
        align: 4,
        offset: 16,
        ty: { Array: { ty: "Felt", len: 4 } },
      },
    ],
  },
};

describe("packageProcedures of a MASM package", () => {
  const counter = exported(
    [masmPath("get_count"), "0x01", 3, true, { params: [], results: ["Felt"] }],
    [
      masmPath("increment_count"),
      "0x02",
      3,
      false,
      { params: ["Felt"], results: [] },
    ],
  );

  it("writes each signature from the source's names and types, in manifest order", () => {
    const procedures = packageProcedures({
      kind: "masm",
      ...counter,
      parameters: {
        [masmPath("get_count")]: [],
        [masmPath("increment_count")]: [{ name: "amount", type: "felt" }],
      },
    });
    expect(procedures).toEqual([
      {
        name: "get_count",
        signature: "pub proc get_count() -> felt",
        digest: "0x01",
        readOnly: true,
      },
      {
        name: "increment_count",
        signature: "pub proc increment_count(amount: felt)",
        digest: "0x02",
        readOnly: false,
      },
    ]);
  });

  it("writes a struct by its declared name and the integers as MASM's", () => {
    const path = masmPath("move_asset_to_note");
    const procedures = packageProcedures({
      kind: "masm",
      ...exported([
        path,
        "0x01",
        3,
        false,
        { params: [asset, "U16"], results: [] },
      ]),
      parameters: {
        [path]: [
          { name: "asset", type: "Asset" },
          { name: "note_idx", type: "u16" },
        ],
      },
    });
    expect(signatures(procedures)).toEqual([
      "pub proc move_asset_to_note(asset: Asset, note_idx: u16)",
    ]);
  });

  it("writes only the types of a procedure without names", () => {
    const path = masmPath("mix");
    const procedures = packageProcedures({
      kind: "masm",
      ...exported([
        path,
        "0x01",
        3,
        null,
        {
          params: [
            { Array: { ty: "Felt", len: 4 } },
            "I1",
            "U64",
            asset,
            { Array: { ty: "U32", len: 2 } },
            { Ptr: { addrspace: "Element", pointee: "Felt" } },
            { Struct: { name: null, repr: "Default", size: 8, fields: [] } },
          ],
          results: ["Felt", "Felt"],
        },
      ]),
      parameters: {},
    });
    expect(signatures(procedures)).toEqual([
      "pub proc mix(word, i1, u64, Asset, [u32; 2], ptr<felt>, _) -> (felt, felt)",
    ]);
  });

  it("keeps a quoted name and writes a note's entrypoint", () => {
    const quoted = '::counter_contract::"get-count"';
    const procedures = packageProcedures({
      kind: "masm",
      ...exported(
        [quoted, "0x01", 3, true, { params: [], results: ["Felt"] }],
        ["::counter_note::main", "0x02", 3, null],
      ),
      parameters: { "::counter_note::main": [] },
    });
    expect(signatures(procedures)).toEqual([
      'pub proc "get-count"() -> felt',
      "pub proc main()",
    ]);
  });
});
