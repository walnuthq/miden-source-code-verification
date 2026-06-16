// Filters a directory selected via a `webkitdirectory` input down to the subset
// the verifier cares about, and reads the kept files into a path -> content map.
//
// Port of the Rust logic in walnuthq/miden-verify (`is_included` / `collect_files`):
// keep files under any `src/` dir, plus `Cargo.toml`, `rust-toolchain.toml`, and
// `.cargo/config.toml`; prune `target/` and hidden dirs (except `.cargo`).

export type ProjectFiles = {
  files: Record<string, string>;
  entrypoints: string[];
};

// The browser prefixes every `webkitRelativePath` with the picked folder's own
// name; drop it so keys are relative to the selected folder.
function stripRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

// Mirrors the Rust walker pruning `target/` and hidden dirs other than `.cargo`.
// Runs before inclusion: a `src` dir can exist under `target`.
function isSkippedDir(parents: string[]): boolean {
  return parents.some(
    (part) => part === "target" || (part.startsWith(".") && part !== ".cargo"),
  );
}

function isIncluded(rel: string): boolean {
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  const parents = parts.slice(0, -1);
  if (parents.includes("src")) return true;
  if (name === "Cargo.toml" || name === "rust-toolchain.toml") return true;
  if (name === "config.toml" && parents[parents.length - 1] === ".cargo") {
    return true;
  }
  return false;
}

/**
 * Pure path filtering over raw `webkitRelativePath` strings. Returns the kept
 * paths (relative to the selected folder) and the entrypoints: directories that
 * directly contain a `Cargo.toml`, as folder names, with the root excluded.
 */
export function selectProjectFiles(webkitRelativePaths: string[]): {
  includedPaths: string[];
  entrypoints: string[];
} {
  const includedPaths: string[] = [];
  const entrypoints = new Set<string>();

  for (const path of webkitRelativePaths) {
    const rel = stripRoot(path);
    const parts = rel.split("/");
    const parents = parts.slice(0, -1);
    if (isSkippedDir(parents) || !isIncluded(rel)) continue;

    includedPaths.push(rel);
    if (parts[parts.length - 1] === "Cargo.toml") {
      const dir = parents.join("/");
      if (dir) entrypoints.add(dir);
    }
  }

  return { includedPaths, entrypoints: [...entrypoints].sort() };
}

// Reads a file's text content, per spec, via FileReader.readAsArrayBuffer.
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new TextDecoder("utf-8").decode(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Filters the selected directory and reads the kept files into a
 * `{ files, entrypoints }` object for later verification use.
 */
export async function collectProjectFiles(
  fileList: FileList | File[],
): Promise<ProjectFiles> {
  const files = Array.from(fileList);

  // Pass the raw paths — selectProjectFiles strips the root itself.
  const { includedPaths, entrypoints } = selectProjectFiles(
    files.map((file) => file.webkitRelativePath || file.name),
  );
  const included = new Set(includedPaths);

  const entries = await Promise.all(
    files
      .map((file) => ({
        rel: stripRoot(file.webkitRelativePath || file.name),
        file,
      }))
      .filter(({ rel }) => included.has(rel))
      .map(async ({ rel, file }) => [rel, await readFileText(file)] as const),
  );

  return { files: Object.fromEntries(entries), entrypoints };
}
