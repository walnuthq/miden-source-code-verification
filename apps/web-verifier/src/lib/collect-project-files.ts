// Filters a directory selected via a `webkitdirectory` input down to the subset
// the verifier cares about, and reads the kept files into a path -> content map.
//
// A project is a directory holding a `miden-project.toml`. Kept files: every
// `*.masm` file and every `miden-project.toml`, wherever it sits, since a
// manifest's `[lib] path` can point anywhere. `target/` and hidden dirs are
// pruned everywhere.
//
// The entrypoints are the project directories, plus the root (`.`) when it
// holds a `miden-project.toml`. A folder with a `Cargo.toml` and no
// `miden-project.toml` is a Rust project, which is refused before anything is
// read.

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

export const RUST_FOLDER_ERROR =
  "This is a Rust project, and Rust projects are no longer verified. Miden projects are written in MASM: pick a folder with a miden-project.toml.";

// The browser prefixes every `webkitRelativePath` with the picked folder's own
// name; drop it so keys are relative to the selected folder.
function stripRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function isSkippedDir(parents: string[]): boolean {
  return parents.some((part) => part === "target" || part.startsWith("."));
}

const MIDEN_PROJECT_TOML = "miden-project.toml";

function isBuildInput(name: string): boolean {
  return name === MIDEN_PROJECT_TOML || name.endsWith(".masm");
}

type SplitPath = { rel: string; name: string; parents: string[] };

function splitPath(rel: string): SplitPath {
  const parts = rel.split("/");
  return { rel, name: parts[parts.length - 1], parents: parts.slice(0, -1) };
}

/**
 * Pure path filtering over raw `webkitRelativePath` strings. Returns the kept
 * paths (relative to the selected folder), the sorted entrypoints, and whether
 * the folder is a Rust project: a `Cargo.toml` and no `miden-project.toml`.
 */
export function selectProjectFiles(webkitRelativePaths: string[]): {
  includedPaths: string[];
  entrypoints: string[];
  isRustProject: boolean;
} {
  // Pruning runs first: a manifest can exist under `target`.
  const paths = webkitRelativePaths
    .map((path) => splitPath(stripRoot(path)))
    .filter(({ parents }) => !isSkippedDir(parents));

  const includedPaths = paths.filter(({ name }) => isBuildInput(name)).map(({ rel }) => rel);
  const projectDirs = new Set(
    paths
      .filter(({ name }) => name === MIDEN_PROJECT_TOML)
      .map(({ parents }) => (parents.length === 0 ? "." : parents.join("/"))),
  );
  const isRustProject = projectDirs.size === 0 && paths.some(({ name }) => name === "Cargo.toml");
  return { includedPaths, entrypoints: [...projectDirs].sort(), isRustProject };
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
  const { includedPaths, entrypoints, isRustProject } = selectProjectFiles(
    files.map((file) => file.webkitRelativePath || file.name),
  );
  if (isRustProject) {
    return { error: RUST_FOLDER_ERROR };
  }
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
