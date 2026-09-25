import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// A manifest exporting each `[path, digest, abi]`.
const manifest = (
  ...exports: [path: string, digest: string, abi: number][]
): PackageManifest => ({
  exports: exports.map(([path, digest, abi]) => ({
    Procedure: { path, digest, signature: { abi } },
  })),
  dependencies: [],
});

const counterPath = (name: string) =>
  `::"miden:counter-contract/counter-contract@0.1.0"::${name}`;

const signatures = (procedures: PackageProcedure[]) =>
  procedures.map(({ signature }) => signature);

describe("procedureName", () => {
  it("takes the last path segment, unquoted, snake-cased", () => {
    expect(procedureName(counterPath('"get-count"'))).toBe("get_count");
    expect(
      procedureName('::"miden:counter-note/miden-counter-note@0.1.0"::run'),
    ).toBe("run");
  });
});

describe("packageProcedures", () => {
  it("reads account procedures from the #[component] trait, in source order", () => {
    const files = {
      "counter-contract/src/lib.rs": readExample(
        "counter-contract/counter-contract/src/lib.rs",
      ),
    };
    const procedures = packageProcedures({
      // Exported alphabetically, as the compiler does, plus `init` (abi 0).
      manifest: manifest(
        [counterPath('"get-count"'), "0x01", 3],
        [counterPath('"increment-count"'), "0x02", 3],
        [counterPath("init"), "0x03", 0],
      ),
      files,
      entryPath: "counter-contract/src/lib.rs",
    });
    expect(procedures).toEqual([
      {
        name: "get_count",
        signature: "fn get_count(&self) -> Felt;",
        digest: "0x01",
      },
      {
        name: "increment_count",
        signature: "fn increment_count(&mut self) -> Felt;",
        digest: "0x02",
      },
    ]);
  });

  it("reads a note's entrypoint after #[note_script], without its body", () => {
    const procedures = packageProcedures({
      manifest: manifest([
        '::"miden:counter-note/miden-counter-note@0.1.0"::run',
        "0x01",
        3,
      ]),
      files: {
        "src/lib.rs": readExample("counter-contract/counter-note/src/lib.rs"),
      },
      entryPath: "src/lib.rs",
    });
    expect(signatures(procedures)).toEqual([
      "fn run(self, _arg: Word, account: &mut CounterAccount);",
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
      manifest: manifest([counterPath("send"), "0x01", 3]),
      files: { "src/lib.rs": source },
      entryPath: "src/lib.rs",
    });
    expect(signatures(procedures)).toEqual([
      "fn send(&mut self, asset: Asset, slots: [Felt; 4]) -> NoteIdx;",
    ]);
  });

  it("only searches the package's own crate", () => {
    const procedures = packageProcedures({
      manifest: manifest([counterPath('"get-count"'), "0x01", 3]),
      files: {
        "counter-contract/src/lib.rs": "#[component]\ntrait Counter {}\n",
        "count-reader/src/lib.rs":
          "#[component]\ntrait Reader {\n    fn get_count(&self) -> u64;\n}\n",
      },
      entryPath: "counter-contract/src/lib.rs",
    });
    expect(signatures(procedures)).toEqual(["fn get_count"]);
  });

  it("falls back to the name when the signature can't be found, listed last", () => {
    const procedures = packageProcedures({
      manifest: manifest(
        [counterPath("missing"), "0x01", 3],
        [counterPath('"get-count"'), "0x02", 3],
      ),
      files: {
        "src/lib.rs": "#[component]\ntrait C {\n    fn get_count(&self);\n}\n",
      },
      entryPath: "src/lib.rs",
    });
    expect(signatures(procedures)).toEqual([
      "fn get_count(&self);",
      "fn missing",
    ]);
  });
});
