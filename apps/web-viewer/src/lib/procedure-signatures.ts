import type { PackageManifest } from "@/lib/api-registry.server";

// A procedure a package installs in its account (or a note's entrypoint), as
// its card lists it: its Rust name, the signature it was compiled from, and its
// digest.
export type PackageProcedure = {
  name: string;
  signature: string;
  digest: string;
};

// Only the procedures a package exports with the ComponentModel calling
// convention (abi 3) are account procedures, or a note script's entrypoint; the
// rest are toolchain internals (see the verifier's `verify_account_component`
// and `verify_note_script`).
const COMPONENT_MODEL_ABI = 3;

// The Rust name of an exported procedure: the last segment of its path, which
// the compiler kebab-cases and quotes when it has to, e.g.
// `::"miden:counter-contract/counter-contract@0.1.0"::"get-count"` → `get_count`.
export function procedureName(path: string): string {
  const segment = path.slice(path.lastIndexOf("::") + 2);
  return segment.replace(/^"|"$/g, "").replaceAll("-", "_");
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

// The package's account procedures (or a note's entrypoint), each with its
// signature read from the package's crate: the `.rs` files beside its entry
// file, the entry file first. Listed in the order they are declared, as in the
// source; one whose signature can't be found falls back to `fn <name>` after
// the others.
export function packageProcedures({
  manifest,
  files,
  entryPath,
}: {
  manifest: PackageManifest;
  files: Record<string, string>;
  entryPath: string | null;
}): PackageProcedure[] {
  const sourceDir = entryPath?.slice(0, entryPath.lastIndexOf("/") + 1) ?? "";
  const sources = Object.keys(files)
    .filter(
      (path) =>
        path.endsWith(".rs") &&
        path.startsWith(sourceDir) &&
        (entryPath !== null || !path.includes("/")),
    )
    .sort((a, b) => Number(b === entryPath) - Number(a === entryPath))
    .map((path) => maskSource(files[path]));

  const procedures = manifest.exports.flatMap(({ Procedure }) =>
    Procedure?.signature?.abi === COMPONENT_MODEL_ABI ? [Procedure] : [],
  );
  const located = procedures.map(({ path, digest }) => {
    const name = procedureName(path);
    for (const [fileIndex, masked] of sources.entries()) {
      const start = findFunction(masked, name);
      const signature = start === null ? null : readSignature(masked, start);
      if (start !== null && signature) {
        return { name, signature, digest, order: [fileIndex, start] };
      }
    }
    return {
      name,
      signature: `fn ${name}`,
      digest,
      order: [Number.POSITIVE_INFINITY, 0],
    };
  });
  return located
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map(({ name, signature, digest }) => ({ name, signature, digest }));
}
