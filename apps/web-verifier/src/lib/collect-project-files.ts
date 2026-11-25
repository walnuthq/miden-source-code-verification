// Filters a directory selected via a `webkitdirectory` input down to the subset
// the verifier cares about, and reads the kept files into a path -> content map.
//
// A project is a directory holding a `miden-project.toml` or a `Cargo.toml`. It
// is a Rust project when a `Cargo.toml` sits there, a MASM project otherwise.
// A file belongs to the nearest project above it. Kept files:
//
// - every `*.masm` file and every `miden-project.toml`, wherever it sits: a
//   MASM manifest's `[lib] path` can point anywhere;
// - in a Rust project, or outside any project, also the rules of the
//   walnuthq/miden-verify CLI (`is_included`): files under any `src/` dir, plus
//   `Cargo.toml`, `Cargo.lock`, `build.rs`, `rust-toolchain.toml` and
//   `.cargo/config.toml`. `Cargo.lock` pins dependency versions, so the
//   verifier builds what the author built. Outside any project, because a Rust
//   workspace can keep `.cargo/config.toml` above its crates.
//
// `target/` and hidden dirs (except `.cargo`) are pruned everywhere.
//
// The entrypoints are the project directories, plus the root (`.`) when it
// holds a `miden-project.toml`. A root holding only a `Cargo.toml` is a Rust
// workspace, not something to build, so it stays out of the list.

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
  return parents.some((part) => part === "target" || (part.startsWith(".") && part !== ".cargo"));
}

function isRustBuildInput(name: string, parents: string[]): boolean {
  if (parents.includes("src")) return true;
  if (
    name === "Cargo.toml" ||
    name === "Cargo.lock" ||
    name === "build.rs" ||
    name === "rust-toolchain.toml"
  )
    return true;
  return name === "config.toml" && parents[parents.length - 1] === ".cargo";
}

function isMasmBuildInput(name: string): boolean {
  return name === "miden-project.toml" || name.endsWith(".masm");
}

type ProjectKind = "rust" | "masm";

type SplitPath = { rel: string; name: string; parents: string[] };

function splitPath(rel: string): SplitPath {
  const parts = rel.split("/");
  return { rel, name: parts[parts.length - 1], parents: parts.slice(0, -1) };
}

// The kind of each project directory, keyed by its path ("" for the root).
function findProjects(paths: SplitPath[]): Map<string, ProjectKind> {
  const projects = new Map<string, ProjectKind>();
  for (const { name, parents } of paths) {
    const dir = parents.join("/");
    if (name === "Cargo.toml") projects.set(dir, "rust");
    else if (name === "miden-project.toml" && !projects.has(dir)) {
      projects.set(dir, "masm");
    }
  }
  return projects;
}

// The kind of the nearest project holding the file, or null outside any.
function owningProjectKind(
  parents: string[],
  projects: Map<string, ProjectKind>,
): ProjectKind | null {
  for (let depth = parents.length; depth >= 0; depth--) {
    const kind = projects.get(parents.slice(0, depth).join("/"));
    if (kind) return kind;
  }
  return null;
}

/**
 * Pure path filtering over raw `webkitRelativePath` strings. Returns the kept
 * paths (relative to the selected folder) and the sorted entrypoints.
 */
export function selectProjectFiles(webkitRelativePaths: string[]): {
  includedPaths: string[];
  entrypoints: string[];
} {
  // Pruning runs first: a `src` dir or a manifest can exist under `target`.
  const paths = webkitRelativePaths
    .map((path) => splitPath(stripRoot(path)))
    .filter(({ parents }) => !isSkippedDir(parents));
  const projects = findProjects(paths);

  const includedPaths = paths
    .filter(
      ({ name, parents }) =>
        isMasmBuildInput(name) ||
        (owningProjectKind(parents, projects) !== "masm" && isRustBuildInput(name, parents)),
    )
    .map(({ rel }) => rel);

  const rootHasManifest = paths.some(
    ({ name, parents }) => parents.length === 0 && name === "miden-project.toml",
  );
  const entrypoints = [...projects.keys()]
    .filter((dir) => dir !== "")
    .concat(rootHasManifest ? ["."] : [])
    .sort();
  return { includedPaths, entrypoints };
}

// Reads a file's text content; `null` when its bytes aren't UTF-8.
async function readFileText(file: File): Promise<string | null> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
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
      error: "The selected project is larger than 1 MB, the most the verifier accepts.",
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
