import type {
  CallConv,
  FunctionType,
  ReadOnlyProcedures,
  Type,
  Word,
} from "miden-source-code-verification-utils/manifest";
import { describe, expect, it } from "vitest";

import type { PackageManifest } from "@/lib/api-registry.server";
import { type PackageProcedure, packageProcedures } from "@/lib/procedure-signatures";

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
      ([path, digest, abi, , { params, results } = { params: [], results: [] }]) => ({
        Procedure: { path, digest, signature: { abi, params, results } },
      }),
    ),
    dependencies: [],
  },
  readOnly: Object.fromEntries(exports.map(([path, , , readOnly = null]) => [path, readOnly])),
});

const signatures = (procedures: PackageProcedure[]) => procedures.map(({ signature }) => signature);

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

describe("packageProcedures", () => {
  const counter = exported(
    [masmPath("get_count"), "0x01", 3, true, { params: [], results: ["Felt"] }],
    [masmPath("increment_count"), "0x02", 3, false, { params: ["Felt"], results: [] }],
  );

  it("writes each signature from the source's names and types, in manifest order", () => {
    const procedures = packageProcedures({
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
      ...exported([path, "0x01", 3, false, { params: [asset, "U16"], results: [] }]),
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
      ...exported(
        [quoted, "0x01", 3, true, { params: [], results: ["Felt"] }],
        ["::counter_note::main", "0x02", 3, null],
      ),
      parameters: { "::counter_note::main": [] },
    });
    expect(signatures(procedures)).toEqual(['pub proc "get-count"() -> felt', "pub proc main()"]);
  });

  it("leaves out exports that aren't account procedures", () => {
    const procedures = packageProcedures({
      ...exported(
        [masmPath("get_count"), "0x01", 3, true, { params: [], results: ["Felt"] }],
        [masmPath("init"), "0x03", 0, true],
      ),
      parameters: { [masmPath("get_count")]: [] },
    });
    expect(signatures(procedures)).toEqual(["pub proc get_count() -> felt"]);
  });
});
