import {
  type MaspVariant,
  packageMaspPath,
} from "miden-source-code-verification-utils/api-registry";
import type {
  NoteStorageField,
  StorageSlotSchema,
} from "miden-source-code-verification-utils/manifest";
import {
  cargoPackageName,
  midenProjectLibrary,
} from "miden-source-code-verification-utils/project";
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
// procedures, storage schemas, dependencies, verification time and source
// head the package's card.
export type PackageSources = {
  name: string;
  commitment: string;
  // Whether the registry holds a debug build of the package to download.
  hasDebugBuild: boolean;
  procedures: PackageProcedure[];
  // An account component's storage slots, and a note's storage fields (its
  // inputs): empty when the package has none.
  storageSlots: StorageSlotSchema[];
  noteStorageFields: NoteStorageField[];
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

// Where the page downloads a package's compiled MASP, or its debug build:
// straight from the registry, whose `Content-Disposition` names the file
// (`maspDownloadName`, which the page shows next to the link, since a
// cross-origin link's `download` attribute is ignored). `commitment` is the
// release build's either way.
export function packageMaspUrl({
  networkId,
  commitment,
  variant = "release",
}: {
  networkId: string;
  commitment: string;
  variant?: MaspVariant;
}): string {
  return `${PUBLIC_API_REGISTRY_URL}${packageMaspPath(networkId, commitment, variant)}`;
}

// A file (no `children`) or folder in the Source Code explorer.
export type FileTreeNode = {
  name: string;
  path: string;
  children?: FileTreeNode[];
};

const CARGO_TOML = "Cargo.toml";
const MIDEN_PROJECT_TOML = "miden-project.toml";
const MANIFESTS = [CARGO_TOML, MIDEN_PROJECT_TOML];

// The files a package's Source Code section shows: its manifests, the MASM
// modules, and the Rust sources under a `src/` dir. Paths can be prefixed by a
// project dir when the upload held local dependencies too
// (`counter-note/src/lib.rs`, `counter-note/counter_note.masm`), so all are
// matched at any depth. The rest of what the verifier kept (lockfiles, build
// scripts, toolchain and Cargo config) is dropped.
export function isDisplayedSourceFile(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (MANIFESTS.includes(name) || name.endsWith(".masm")) {
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
// package was built from, i.e. the one whose manifest carries the package's
// name, since an upload can also hold the project's local dependencies. For a
// Rust project that's the `src/lib.rs` next to its `Cargo.toml`; for a MASM
// project, a `miden-project.toml` with no `Cargo.toml` beside it, the module
// its `[lib] path` names. Falls back to any `src/lib.rs`, then to the first
// MASM module, then to the first file.
export function findEntryFile(
  files: Record<string, string>,
  packageName: string,
): string | null {
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    if (isManifest(path, CARGO_TOML)) {
      const libPath = `${directoryOf(path, CARGO_TOML)}src/lib.rs`;
      // A manifest that doesn't parse, or has no [package], can't be the
      // entry. Both names come from a manifest, so they match exactly or not
      // at all.
      if (
        libPath in files &&
        cargoPackageName(files[path] ?? "") === packageName
      ) {
        return libPath;
      }
    } else if (isManifest(path, MIDEN_PROJECT_TOML)) {
      const dir = directoryOf(path, MIDEN_PROJECT_TOML);
      if (`${dir}${CARGO_TOML}` in files) {
        continue;
      }
      const library = midenProjectLibrary(files[path] ?? "");
      const libPath = library?.libPath && resolvePath(dir, library.libPath);
      if (library?.name === packageName && libPath && libPath in files) {
        return libPath;
      }
    }
  }
  return (
    paths.find(
      (path) => path === "src/lib.rs" || path.endsWith("/src/lib.rs"),
    ) ??
    paths.find((path) => path.endsWith(".masm")) ??
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
