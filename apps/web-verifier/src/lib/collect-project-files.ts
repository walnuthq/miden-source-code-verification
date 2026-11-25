// Filters a directory selected via a `webkitdirectory` input down to the subset
// the verifier cares about, and reads the kept files into a path -> content map.
//
// A package is a directory holding a `miden-project.toml` or a `Cargo.toml`. It
// is a Rust package when a `Cargo.toml` sits there, a MASM package otherwise.
// A file belongs to the nearest package above it:
//
// - in a MASM package, only `miden-project.toml` and `*.masm` files are kept;
// - in a Rust package, the rules of the walnuthq/miden-verify CLI
//   (`is_included`) apply: files under any `src/` dir, plus `Cargo.toml`,
//   `Cargo.lock`, `build.rs`, `miden-project.toml`, `rust-toolchain.toml` and
//   `.cargo/config.toml`. `Cargo.lock` pins dependency versions, so the
//   verifier builds what the author built;
// - outside any package, both sets are kept: a MASM manifest's `[lib] path` can
//   point anywhere, and a Rust workspace can keep `.cargo/config.toml` above
//   its crates.
//
// `target/` and hidden dirs (except `.cargo`) are pruned everywhere.

export type ProjectFiles = {
  files: Record<string, string>;
  entrypoints: string[];
};

// The registry takes at most 1 MB of JSON; the rest of the request and JSON
// escaping need some of it. The "1 MB" in the size error message must change
// with this.
export const MAX_PROJECT_BYTES = 1_000_000;

// `error` is why the folder can't be submitted, worded for the user.
export type ProjectFilesResult = ProjectFiles | { error: string };

// The browser prefixes every `webkitRelativePath` with the picked folder's own
// name; drop it so keys are relative to the selected folder.
function stripRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

// Mirrors the CLI's walker pruning `target/` and hidden dirs other than `.cargo`.
function isSkippedDir(parents: string[]): boolean {
  return parents.some(
    (part) => part === "target" || (part.startsWith(".") && part !== ".cargo"),
  );
}

function isRustBuildInput(name: string, parents: string[]): boolean {
  if (parents.includes("src")) return true;
  if (
    name === "Cargo.toml" ||
    name === "Cargo.lock" ||
    name === "build.rs" ||
    name === "miden-project.toml" ||
    name === "rust-toolchain.toml"
  )
    return true;
  return name === "config.toml" && parents[parents.length - 1] === ".cargo";
}

function isMasmBuildInput(name: string): boolean {
  return name === "miden-project.toml" || name.endsWith(".masm");
}

type PackageKind = "rust" | "masm";

// The kind of each package directory, keyed by its path ("" for the root).
function findPackages(rels: string[]): Map<string, PackageKind> {
  const packages = new Map<string, PackageKind>();
  for (const rel of rels) {
    const parts = rel.split("/");
    const name = parts[parts.length - 1];
    if (name !== "Cargo.toml" && name !== "miden-project.toml") continue;
    const dir = parts.slice(0, -1).join("/");
    if (name === "Cargo.toml") packages.set(dir, "rust");
    else if (!packages.has(dir)) packages.set(dir, "masm");
  }
  return packages;
}

// The kind of the nearest package holding the file, or null outside any.
function owningPackage(
  parents: string[],
  packages: Map<string, PackageKind>,
): PackageKind | null {
  for (let depth = parents.length; depth >= 0; depth--) {
    const kind = packages.get(parents.slice(0, depth).join("/"));
    if (kind) return kind;
  }
  return null;
}

/**
 * Pure path filtering over raw `webkitRelativePath` strings. Returns the kept
 * paths (relative to the selected folder) and the entrypoints: the package
 * directories of both kinds, as sorted folder paths, with the root excluded.
 */
export function selectProjectFiles(webkitRelativePaths: string[]): {
  includedPaths: string[];
  entrypoints: string[];
} {
  // Pruning runs first: a `src` dir or a manifest can exist under `target`.
  const rels = webkitRelativePaths
    .map(stripRoot)
    .filter((rel) => !isSkippedDir(rel.split("/").slice(0, -1)));
  const packages = findPackages(rels);

  const includedPaths = rels.filter((rel) => {
    const parts = rel.split("/");
    const name = parts[parts.length - 1];
    const parents = parts.slice(0, -1);
    const owner = owningPackage(parents, packages);
    if (owner === "masm") return isMasmBuildInput(name);
    if (owner === "rust") return isRustBuildInput(name, parents);
    return isMasmBuildInput(name) || isRustBuildInput(name, parents);
  });

  const entrypoints = [...packages.keys()].filter((dir) => dir !== "").sort();
  return { includedPaths, entrypoints };
}

// Reads a file's text content; `null` when its bytes aren't UTF-8.
async function readFileText(file: File): Promise<string | null> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch (error) {
    if (error instanceof TypeError) return null; // not UTF-8
    throw error;
  }
}

/**
 * Filters the selected directory and reads the kept files into a
 * `{ files, entrypoints }` object for later verification use.
 */
export async function collectProjectFiles(
  fileList: FileList | File[],
): Promise<ProjectFilesResult> {
  const files = Array.from(fileList);

  // Pass the raw paths — selectProjectFiles strips the root itself.
  const { includedPaths, entrypoints } = selectProjectFiles(
    files.map((file) => file.webkitRelativePath || file.name),
  );
  const included = new Set(includedPaths);

  const kept = files
    .map((file) => ({
      rel: stripRoot(file.webkitRelativePath || file.name),
      file,
    }))
    .filter(({ rel }) => included.has(rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const totalBytes = kept.reduce((sum, { file }) => sum + file.size, 0);
  if (totalBytes > MAX_PROJECT_BYTES) {
    return {
      error:
        "The selected project is larger than 1 MB, the most the verifier accepts.",
    };
  }

  const entries = await Promise.all(
    kept.map(async ({ rel, file }) => [rel, await readFileText(file)] as const),
  );
  const projectFiles: Record<string, string> = {};
  for (const [rel, text] of entries) {
    if (text === null) return { error: `${rel} is not a UTF-8 text file.` };
    projectFiles[rel] = text;
  }

  return { files: projectFiles, entrypoints };
}
