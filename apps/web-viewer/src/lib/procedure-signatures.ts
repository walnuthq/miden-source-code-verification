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

// The Rust name of an exported procedure: the last segment of its path, which
// the compiler kebab-cases and quotes when it has to, e.g.
// `::"miden:counter-contract/counter-contract@0.1.0"::"get-count"` → `get_count`.
// `deposit-asset` → `deposit_asset`.
function snakeCase(name: string): string {
  return name.replaceAll("-", "_");
}

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
// signature, which the WIT names pair with by index.
function namedSignature(
  name: string,
  { params, results }: { params: Type[]; results: Type[] },
  parameters: ProcedureParameter[],
): string {
  const args = parameters
    .map(
      (parameter, index) =>
        `${snakeCase(parameter.name)}: ${rustType(params[index], pascalCase(parameter.type))}`,
    )
    .join(", ");
  const returned =
    results.length === 0
      ? ""
      : results.length === 1
        ? ` -> ${rustType(results[0])}`
        : ` -> (${results.map((result) => rustType(result)).join(", ")})`;
  return `fn ${name}(${args})${returned};`;
}

// The source with comments and string literals blanked out, character for
// character, so that searches ignore them and indices still line up.
function maskSource(source: string): string {
  let masked = "";
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index, index + 2);
    let end = index + 1;
    if (rest === "//") {
      const newline = source.indexOf("\n", index);
      end = newline === -1 ? source.length : newline;
    } else if (rest === "/*") {
      const close = source.indexOf("*/", index + 2);
      end = close === -1 ? source.length : close + 2;
    } else if (source[index] === '"') {
      end = index + 1;
      while (end < source.length && source[end] !== '"') {
        end += source[end] === "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, source.length);
    } else {
      masked += source[index];
      index = end;
      continue;
    }
    masked += source.slice(index, end).replace(/[^\n]/g, " ");
    index = end;
  }
  return masked;
}

// The signature starting at `start` (a `fn` keyword) in the masked source: up to
// the `;` ending a declaration or the `{` opening a body, whichever comes first
// outside brackets — a `;` also appears in array types such as `[Felt; 4]`.
// Whitespace is collapsed, and the trailing comma rustfmt leaves in a wrapped
// parameter list dropped, so it reads as the one-line declaration.
function readSignature(masked: string, start: number): string | null {
  let depth = 0;
  for (let index = start; index < masked.length; index++) {
    const char = masked[index];
    if (char === "(" || char === "[" || char === "<") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    } else if (char === ">" && masked[index - 1] !== "-") {
      depth--;
    } else if (depth === 0 && (char === ";" || char === "{")) {
      const signature = masked
        .slice(start, index)
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/,?\s*\)/g, ")")
        .trim();
      return `${signature};`;
    }
  }
  return null;
}

// Where `fn <name>` is declared in the masked source, preferring where the
// compiler takes it from: an account procedure's declaration in a
// `#[component]` trait, or the function right after `#[note_script]`. Falls
// back to any `fn <name>`.
function findFunction(masked: string, name: string): number | null {
  const fnPattern = new RegExp(`\\bfn\\s+${name}\\b`, "g");
  const traitPattern =
    /#\[component\]\s*(?:pub(?:\([^)]*\))?\s+)?trait\b[^{]*\{/g;
  for (const trait of masked.matchAll(traitPattern)) {
    const bodyStart = trait.index + trait[0].length;
    let depth = 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < masked.length && depth > 0) {
      if (masked[bodyEnd] === "{") depth++;
      if (masked[bodyEnd] === "}") depth--;
      bodyEnd++;
    }
    fnPattern.lastIndex = bodyStart;
    const match = fnPattern.exec(masked);
    if (match && match.index < bodyEnd) {
      return match.index;
    }
  }
  for (const attribute of masked.matchAll(/#\[note_script\]/g)) {
    const next = /\bfn\s+(\w+)/g;
    next.lastIndex = attribute.index;
    const match = next.exec(masked);
    if (match?.[1] === name) {
      return match.index;
    }
  }
  fnPattern.lastIndex = 0;
  return fnPattern.exec(masked)?.index ?? null;
}

// A signature read from the source without its receiver (`&self`, `&mut self`,
// `self`): the procedure's card already says whether it is read-only, and the
// named signatures have none.
const withoutReceiver = (signature: string) =>
  signature.replace(/\((?:&\s*)?(?:mut\s+)?self\b(?:,\s*)?/, "(");

// The package's account procedures (or a note's entrypoint), in the manifest's
// order. Each signature is written from the parameter names the package's WIT
// gives (`parameters`) and the manifest's types. A procedure without names (a
// package built before `cargo-miden` 0.10 has no WIT, and one stored before the
// registry kept them has `parameters` null until the backfill) falls back to
// its declaration in the package's crate: the `.rs` files beside its entry
// file, the entry file first, or `fn <name>` when it can't be found.
// `readOnly` has every exported procedure's path.
export function packageProcedures({
  manifest,
  readOnly,
  parameters,
  files,
  entryPath,
}: {
  manifest: PackageManifest;
  readOnly: ReadOnlyProcedures;
  parameters: ProcedureParameters | null;
  files: Record<string, string>;
  entryPath: string | null;
}): PackageProcedure[] {
  const sourceDir = entryPath?.slice(0, entryPath.lastIndexOf("/") + 1) ?? "";
  // Masked on first use: only a procedure without names needs them.
  let sources: string[] | undefined;
  const readSources = () => {
    sources ??= Object.keys(files)
      .filter(
        (path) =>
          path.endsWith(".rs") &&
          path.startsWith(sourceDir) &&
          (entryPath !== null || !path.includes("/")),
      )
      .sort((a, b) => Number(b === entryPath) - Number(a === entryPath))
      .map((path) => maskSource(files[path]));
    return sources;
  };
  const sourceSignature = (name: string) => {
    for (const masked of readSources()) {
      const start = findFunction(masked, name);
      const signature = start === null ? null : readSignature(masked, start);
      if (signature) {
        return withoutReceiver(signature);
      }
    }
    return `fn ${name}`;
  };

  return manifest.exports.flatMap(({ Procedure }) => {
    const signature = Procedure?.signature;
    if (!Procedure || signature?.abi !== COMPONENT_MODEL_ABI) {
      return [];
    }
    const { path, digest } = Procedure;
    const name = procedureName(path);
    const named = parameters?.[path];
    return [
      {
        name,
        signature: named
          ? namedSignature(name, signature, named)
          : sourceSignature(name),
        digest,
        readOnly: readOnly[path],
      },
    ];
  });
}
