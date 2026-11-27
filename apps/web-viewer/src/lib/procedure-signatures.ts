import type {
  ProcedureParameter,
  ProcedureParameters,
  ReadOnlyProcedures,
  Type,
} from "miden-source-code-verification-utils/manifest";

import type { PackageManifest } from "@/lib/api-registry.server";

// A procedure a package installs in its account (or a note's entrypoint), as
// its card lists it: its name and MASM signature, its digest, and whether it
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

// The last segment of an export's path: the procedure's name as the MASM
// source declares it, `::counter_contract::get_count` → `get_count`.
const lastSegment = (path: string) => path.slice(path.lastIndexOf("::") + 2);

// A signature's results after its parameters: nothing, ` -> T`, or
// ` -> (T, U)`.
const resultsOf = (results: Type[]) =>
  results.length === 0
    ? ""
    : results.length === 1
      ? ` -> ${masmType(results[0])}`
      : ` -> (${results.map((result) => masmType(result)).join(", ")})`;

// A type of the manifest's signature as MASM spells it: its primitives in
// lower case, a `[felt; 4]` as `word`, other arrays as `[T; N]`, a pointer as
// `ptr<T>`, a struct or enum by its name as declared. `fallback` names a type
// the manifest leaves unnamed, or that MASM can't write (a list).
function masmType(type: Type, fallback = "_"): string {
  if (typeof type === "string") {
    switch (type) {
      case "Unknown":
      case "Never":
        return fallback;
      case "Variadic":
        return "...";
      default:
        return type.toLowerCase();
    }
  }
  if ("Struct" in type || "Enum" in type) {
    return ("Struct" in type ? type.Struct.name : type.Enum.name) ?? fallback;
  }
  if ("Rec" in type) {
    return type.Rec ?? fallback;
  }
  if ("Array" in type) {
    const { ty, len } = type.Array;
    return ty === "Felt" && len === 4 ? "word" : `[${masmType(ty)}; ${len}]`;
  }
  if ("Ptr" in type) {
    return `ptr<${masmType(type.Ptr.pointee)}>`;
  }
  return fallback;
}

// `pub proc increment_count(amount: felt)`, `pub proc get_count() -> felt`:
// the names and types as the MASM source declares them, the results from the
// manifest's signature, whose types the source's names pair with by index.
// Without names (an export `parameters` leaves out), the manifest's types
// alone.
function masmSignature(
  name: string,
  { params, results }: { params: Type[]; results: Type[] },
  parameters: ProcedureParameter[] | undefined,
): string {
  const args = params
    .map((type, index) => {
      const parameter = parameters?.[index];
      return parameter ? `${parameter.name}: ${parameter.type}` : masmType(type);
    })
    .join(", ");
  const returned = resultsOf(results);
  return `pub proc ${name}(${args})${returned}`;
}

// The package's account procedures (or a note's entrypoint), in the manifest's
// order, each signature written from the parameter names the package's MASM
// source gives (`parameters`) and the manifest's types. `readOnly` has every
// exported procedure's path.
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
    const name = lastSegment(path);
    return [
      {
        name,
        signature: masmSignature(name, signature, parameters[path]),
        digest,
        readOnly: readOnly[path],
      },
    ];
  });
}
