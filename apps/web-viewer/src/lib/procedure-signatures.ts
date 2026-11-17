import type {
  ProcedureParameter,
  ProcedureParameters,
  ReadOnlyProcedures,
  Type,
} from "miden-source-code-verification-utils/manifest";

import type { PackageManifest } from "@/lib/api-registry.server";

// A procedure a package installs in its account (or a note's entrypoint), as
// its card lists it: its Rust name, its signature, its digest, and whether it
// is read-only (`null` when that can't be told).
export type PackageProcedure = {
  name: string;
  signature: string;
  digest: string;
  readOnly: boolean | null;
};

// Only the procedures a package exports with the ComponentModel calling
// convention (abi 3) are account procedures, or a note script's entrypoint; the
// rest are toolchain internals (see the verifier's `verify_account_component`
// and `verify_note_script`).
const COMPONENT_MODEL_ABI = 3;

// `deposit-asset` → `deposit_asset`.
function snakeCase(name: string): string {
  return name.replaceAll("-", "_");
}

// The Rust name of an exported procedure: the last segment of its path, which
// the compiler kebab-cases and quotes when it has to, e.g.
// `::"miden:counter-contract/counter-contract@0.1.0"::"get-count"` → `get_count`.
export function procedureName(path: string): string {
  const segment = path.slice(path.lastIndexOf("::") + 2);
  return snakeCase(segment.replace(/^"|"$/g, ""));
}

// `account-id` → `AccountId`.
const pascalCase = (name: string) =>
  name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

// A manifest type's name as the Rust SDK spells it: its last segment,
// `miden:base/core-types@1.0.0/account-id` → `AccountId`.
const typeName = (name: string) =>
  pascalCase(name.slice(name.lastIndexOf("/") + 1));

// A type of the manifest's signature as the Rust SDK names it: a struct or enum
// by the last segment of its name (`miden:base/core-types@1.0.0/account-id` →
// `AccountId`), integers as Rust's. `fallback` names a type the manifest leaves
// unnamed.
function rustType(type: Type, fallback = "_"): string {
  if (typeof type === "string") {
    switch (type) {
      case "Felt":
        return "Felt";
      case "I1":
        return "bool";
      case "Unknown":
      case "Never":
      case "Variadic":
        return fallback;
      default:
        return type.toLowerCase();
    }
  }
  if ("Struct" in type || "Enum" in type) {
    const name = "Struct" in type ? type.Struct.name : type.Enum.name;
    return name ? typeName(name) : fallback;
  }
  if ("Rec" in type) {
    return type.Rec ? typeName(type.Rec) : fallback;
  }
  if ("Array" in type) {
    return `[${rustType(type.Array.ty)}; ${type.Array.len}]`;
  }
  if ("List" in type) {
    return `Vec<${rustType(type.List)}>`;
  }
  return fallback;
}

// `fn deposit(depositor: AccountId, deposit_asset: Asset);`: the names from the
// package's WIT, in snake case, the types and results from the manifest's
// signature, which the WIT names pair with by index. Without names (an export
// `parameters` leaves out), each parameter is `_`.
function signatureOf(
  name: string,
  { params, results }: { params: Type[]; results: Type[] },
  parameters: ProcedureParameter[] | undefined,
): string {
  const args = params
    .map((type, index) => {
      const parameter = parameters?.[index];
      return parameter
        ? `${snakeCase(parameter.name)}: ${rustType(type, pascalCase(parameter.type))}`
        : `_: ${rustType(type)}`;
    })
    .join(", ");
  const returned =
    results.length === 0
      ? ""
      : results.length === 1
        ? ` -> ${rustType(results[0])}`
        : ` -> (${results.map((result) => rustType(result)).join(", ")})`;
  return `fn ${name}(${args})${returned};`;
}

// The package's account procedures (or a note's entrypoint), in the manifest's
// order, each signature written from the parameter names the package's WIT
// gives (`parameters`) and the manifest's types. `readOnly` has every exported
// procedure's path.
export function packageProcedures({
  manifest,
  readOnly,
  parameters,
}: {
  manifest: PackageManifest;
  readOnly: ReadOnlyProcedures;
  parameters: ProcedureParameters;
}): PackageProcedure[] {
  return manifest.exports.flatMap(({ Procedure }) => {
    const signature = Procedure?.signature;
    if (!Procedure || signature?.abi !== COMPONENT_MODEL_ABI) {
      return [];
    }
    const { path, digest } = Procedure;
    const name = procedureName(path);
    return [
      {
        name,
        signature: signatureOf(name, signature, parameters[path]),
        digest,
        readOnly: readOnly[path],
      },
    ];
  });
}
