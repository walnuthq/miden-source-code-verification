import { packageMaspPath } from "miden-source-code-verification-utils/api-registry";
import { midenProjectLibrary } from "miden-source-code-verification-utils/project";

import type { PackageDependency } from "@/lib/api-registry.server";
import { PUBLIC_API_REGISTRY_URL } from "@/lib/constants";
import type { PackageProcedure } from "@/lib/procedure-signatures";

// A package's source file as the pages render it: syntax-highlighted HTML,
// produced on the server (see package-sources.server.ts).
export type SourceFile = { path: string; html: string };

// What the loaders return per package, and what its Source Code section
// renders: the displayed files, sorted by path, and the one opened first.
// `rawFiles` is every file the registry kept for the package, including those
// the explorer hides, for the Download Sources archive. The name, commitment,
// procedures, dependencies, verification time and source head the package's
// card.
export type PackageSources = {
  name: string;
  commitment: string;
  procedures: PackageProcedure[];
  dependencies: PackageDependency[];
  // When the package was verified against the resource, formatted in UTC.
  verifiedAt: string;
  // The client the verification was submitted from (e.g. `miden-verify`).
  source: string;
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

// Where the page downloads a package's compiled MASP: straight from the
// registry, whose `Content-Disposition` names the file (`maspDownloadName`,
// which the page shows next to the link, since a cross-origin link's
// `download` attribute is ignored).
export function packageMaspUrl({
  networkId,
  commitment,
}: {
  networkId: string;
  commitment: string;
}): string {
  return `${PUBLIC_API_REGISTRY_URL}${packageMaspPath(networkId, commitment)}`;
}

// A file (no `children`) or folder in the Source Code explorer.
export type FileTreeNode = {
  name: string;
  path: string;
  children?: FileTreeNode[];
};

const MIDEN_PROJECT_TOML = "miden-project.toml";

// The files a package's Source Code section shows: its manifests and its MASM
// modules. Paths can be prefixed by a project dir when the upload held local
// dependencies too (`counter-note/counter_note.masm`), so all are matched at
// any depth.
export function isDisplayedSourceFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === MIDEN_PROJECT_TOML || name.endsWith(".masm");
}

export function filterSourceFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => isDisplayedSourceFile(path)));
}

// The directory part of a manifest's path, with its trailing `/`: `` at the
// root.
const directoryOf = (manifestPath: string, manifest: string) =>
  manifestPath.slice(0, -manifest.length);

// `dir` (`` or ending in `/`) joined with a manifest's relative path, its `.`
// and `..` segments resolved: `counter-note/` and `../shared/lib.masm` give
// `shared/lib.masm`.
const resolvePath = (dir: string, relative: string) => {
  const segments: string[] = [];
  for (const segment of `${dir}${relative}`.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.join("/");
};

const isManifest = (path: string, manifest: string) =>
  path === manifest || path.endsWith(`/${manifest}`);

// The file a package's viewer opens first: the root module of the project the
// package was built from, i.e. the module named by the `[lib] path` of the
// `miden-project.toml` that carries the package's name, since an upload can
// also hold the project's local dependencies. Falls back to the first MASM
// module, then to the first file.
export function findEntryFile(files: Record<string, string>, packageName: string): string | null {
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    if (isManifest(path, MIDEN_PROJECT_TOML)) {
      const library = midenProjectLibrary(files[path] ?? "");
      const libPath =
        library?.libPath && resolvePath(directoryOf(path, MIDEN_PROJECT_TOML), library.libPath);
      if (library?.name === packageName && libPath && libPath in files) {
        return libPath;
      }
    }
  }
  return paths.find((path) => path.endsWith(".masm")) ?? paths[0] ?? null;
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
