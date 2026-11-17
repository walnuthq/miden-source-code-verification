import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const examplesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../api-compile/examples",
);
const readExample = (relativePath: string) =>
  readFileSync(path.join(examplesDir, relativePath), "utf8");

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
  files: {
    "src/lib.rs": readExample("miden-bank/bank-account/src/lib.rs"),
  },
  entryPath: "src/lib.rs",
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

describe("packageProcedures", () => {
  describe("with the WIT's names", () => {
    it("writes each signature from the names and the manifest's types, in manifest order", () => {
      const procedures = packageProcedures({
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
        ...exported([
          notePath,
          "0x01",
          3,
          null,
          { params: [core("word")], results: [] },
        ]),
        parameters: { [notePath]: [{ name: "arg", type: "word" }] },
        files: {
          "src/lib.rs": readExample("counter-contract/counter-note/src/lib.rs"),
        },
        entryPath: "src/lib.rs",
      });
      expect(signatures(procedures)).toEqual(["fn run(arg: Word);"]);
    });

    it("writes Rust's integers, arrays, lists, and a type the manifest leaves unnamed", () => {
      const path = counterPath("mix");
      const procedures = packageProcedures({
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
        files: {},
        entryPath: null,
      });
      expect(signatures(procedures)).toEqual([
        "fn mix(amount: u64, flag: bool, slots: [Felt; 4], bytes: Vec<u8>, pair: PricePair) -> (u32, Felt);",
      ]);
    });

    it("leaves out exports that aren't account procedures", () => {
      const procedures = packageProcedures({
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
        files: {},
        entryPath: null,
      });
      expect(signatures(procedures)).toEqual(["fn get_count() -> Felt;"]);
    });
  });

  describe("without names, from the source", () => {
    it("reads account procedures from the #[component] trait, without the receiver", () => {
      const files = {
        "counter-contract/src/lib.rs": readExample(
          "counter-contract/counter-contract/src/lib.rs",
        ),
      };
      const procedures = packageProcedures({
        // Exported alphabetically, as the compiler does, plus `init` (abi 0).
        ...exported(
          [counterPath('"get-count"'), "0x01", 3, true],
          [counterPath('"increment-count"'), "0x02", 3, false],
          [counterPath("init"), "0x03", 0, true],
        ),
        // A package the registry stored before it kept them.
        parameters: null,
        files,
        entryPath: "counter-contract/src/lib.rs",
      });
      expect(procedures).toEqual([
        {
          name: "get_count",
          signature: "fn get_count() -> Felt;",
          digest: "0x01",
          readOnly: true,
        },
        {
          name: "increment_count",
          signature: "fn increment_count() -> Felt;",
          digest: "0x02",
          readOnly: false,
        },
      ]);
    });

    it("falls back per procedure the names leave out", () => {
      const { [bankPath("deposit")]: _, ...parameters } = bankParameters;
      const procedures = packageProcedures({ ...bank, parameters });
      expect(signatures(procedures)).toEqual([
        "fn get_depositor_balance(depositor: AccountId, asset: Asset) -> Felt;",
        "fn deposit(depositor: AccountId, deposit_asset: Asset);",
        "fn initialize();",
        "fn withdraw(withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);",
      ]);
    });

    it("reads a note's entrypoint after #[note_script], without its body", () => {
      const procedures = packageProcedures({
        ...exported([notePath, "0x01", 3]),
        parameters: {},
        files: {
          "src/lib.rs": readExample("counter-contract/counter-note/src/lib.rs"),
        },
        entryPath: "src/lib.rs",
      });
      expect(signatures(procedures)).toEqual([
        "fn run(_arg: Word, account: &mut CounterAccount);",
      ]);
    });

    it("prefers the trait declaration over the impl, and joins wrapped lines", () => {
      const source = `
#[component]
impl Wallet for WalletStorage {
    fn send(&mut self, asset: Asset) { todo!() }
}

#[component]
trait Wallet {
    /// Sends an asset; see \`fn send(\`.
    #[account_procedure]
    fn send(
        &mut self,
        asset: Asset,
        slots: [Felt; 4],
    ) -> NoteIdx;
}
`;
      const procedures = packageProcedures({
        ...exported([counterPath("send"), "0x01", 3]),
        parameters: null,
        files: { "src/lib.rs": source },
        entryPath: "src/lib.rs",
      });
      expect(signatures(procedures)).toEqual([
        "fn send(asset: Asset, slots: [Felt; 4]) -> NoteIdx;",
      ]);
    });

    it("only searches the package's own crate", () => {
      const procedures = packageProcedures({
        ...exported([counterPath('"get-count"'), "0x01", 3]),
        parameters: null,
        files: {
          "counter-contract/src/lib.rs": "#[component]\ntrait Counter {}\n",
          "count-reader/src/lib.rs":
            "#[component]\ntrait Reader {\n    fn get_count(&self) -> u64;\n}\n",
        },
        entryPath: "counter-contract/src/lib.rs",
      });
      expect(signatures(procedures)).toEqual(["fn get_count"]);
    });

    it("falls back to the name when the signature can't be found", () => {
      const procedures = packageProcedures({
        ...exported(
          [counterPath("missing"), "0x01", 3],
          [counterPath('"get-count"'), "0x02", 3],
        ),
        parameters: null,
        files: {
          "src/lib.rs":
            "#[component]\ntrait C {\n    fn get_count(&self);\n}\n",
        },
        entryPath: "src/lib.rs",
      });
      expect(signatures(procedures)).toEqual(["fn missing", "fn get_count();"]);
    });
  });
});
