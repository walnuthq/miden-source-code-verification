import { parseCargoToml } from "miden-source-code-verification-utils";

// A package's source file as the pages render it: syntax-highlighted HTML,
// produced on the server (see package-sources.server.ts).
export type SourceFile = { path: string; html: string };

// What the loaders return per package, and what its Source Code section
// renders: the displayed files, sorted by path, and the one opened first.
// `rawFiles` is every file the registry kept for the package, including those
// the explorer hides, for the Download Sources archive.
export type PackageSources = {
  name: string;
  files: SourceFile[];
  entryPath: string | null;
  rawFiles: Record<string, string>;
};

// The Download Sources archive's file name, e.g.
// `mtst-0xad41ad8e-counter-contract.zip`: the network and an ID prefix keep the
// same package downloaded from two resources apart.
export function sourcesArchiveName({
  networkId,
  id,
  packageName,
}: {
  networkId: string;
  id: string;
  packageName: string;
}): string {
  return `${networkId}-${id.slice(0, 10)}-${packageName}.zip`;
}

// A file (no `children`) or folder in the Source Code explorer.
export type FileTreeNode = {
  name: string;
  path: string;
  children?: FileTreeNode[];
};

const MANIFESTS = ["Cargo.toml", "miden-project.toml"];

// The files a package's Source Code section shows: its manifests and the Rust
// sources under a `src/` dir. Paths can be prefixed by a project dir when the
// upload held local dependencies too (`counter-note/src/lib.rs`), so both are
// matched at any depth. The rest of what the verifier kept (lockfiles, build
// scripts, toolchain and Cargo config) is dropped.
export function isDisplayedSourceFile(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (MANIFESTS.includes(name)) {
    return true;
  }
  return name.endsWith(".rs") && parts.slice(0, -1).includes("src");
}

export function filterSourceFiles(
  files: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => isDisplayedSourceFile(path)),
  );
}

// Cargo accepts `-` and `_` interchangeably in crate names.
const normalizeCrateName = (name: string) => name.replaceAll("_", "-");

// The file a package's viewer opens first: the `src/lib.rs` of the crate the
// package was built from, i.e. the one whose Cargo.toml carries the package's
// name, since an upload can also hold the crate's local dependencies. Falls
// back to any `src/lib.rs`, then to the first file.
export function findEntryFile(
  files: Record<string, string>,
  packageName: string,
): string | null {
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    if (path !== "Cargo.toml" && !path.endsWith("/Cargo.toml")) {
      continue;
    }
    const libPath = `${path.slice(0, -"Cargo.toml".length)}src/lib.rs`;
    if (!(libPath in files)) {
      continue;
    }
    try {
      const { package: cargoPackage } = parseCargoToml(files[path]);
      if (
        normalizeCrateName(cargoPackage.name) ===
        normalizeCrateName(packageName)
      ) {
        return libPath;
      }
    } catch {
      // A manifest that doesn't parse (or has no [package]) can't be the entry.
    }
  }
  return (
    paths.find(
      (path) => path === "src/lib.rs" || path.endsWith("/src/lib.rs"),
    ) ??
    paths[0] ??
    null
  );
}

// Folders first, then files, each alphabetically, as VS Code's explorer does.
// An explicit locale keeps the order identical on the server and the client.
function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (!a.children !== !b.children) {
    return a.children ? -1 : 1;
  }
  return a.name.localeCompare(b.name, "en");
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
  return nodes.sort(compareNodes);
}

// The explorer tree for a list of file paths.
export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, index) => {
      const nodePath = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) {
        level.push({ name, path: nodePath });
        return;
      }
      let folder = level.find((node) => node.children && node.name === name);
      if (!folder) {
        folder = { name, path: nodePath, children: [] };
        level.push(folder);
      }
      level = folder.children ?? [];
    });
  }
  return sortTree(root);
}
