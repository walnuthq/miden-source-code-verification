import { parse } from "smol-toml";

// A Project (see GLOSSARY.md): a files map plus an entrypoint that builds into
// one package. Keys are project-relative paths. A Rust project has a
// `Cargo.toml` with a `[package]` at its entrypoint, and a `miden-project.toml`
// next to it; cargo-miden builds it. Any other project is a MASM project: a
// `miden-project.toml` with a `[package]` at its entrypoint, which the
// assembler builds. This module is the only reader of `Cargo.toml` and
// `miden-project.toml` in the repo, and the one place that says why a
// submitted files map isn't a project.
export type Project = {
  files: Record<string, string>;
  // `.` for the root, otherwise a relative directory with no leading `./` and
  // no trailing `/`.
  entrypoint: string;
  // The `[package] name` of the entrypoint's `Cargo.toml`, or of its
  // `miden-project.toml` for a MASM project.
  name: string;
  // Which toolchain builds it: cargo-miden, or the MASM assembler.
  kind: ProjectKind;
};

export type ProjectKind = "rust" | "masm";

// `error` is the reason a files map isn't a project, worded for the client:
// the routes answer it as a 400 as is.
export type ProjectResult = { project: Project } | { error: string };

const CARGO_TOML = "Cargo.toml";
const MIDEN_PROJECT_TOML = "miden-project.toml";

const MAX_SEGMENT_BYTES = 255;
const textEncoder = new TextEncoder();
const hasControlCharacter = (path: string) =>
  [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

// A clean project-relative path: `/`-separated segments, none of them empty,
// `.` or `..`, or longer than 255 bytes, and no backslash or control
// character. Every such path written under a directory stays under it, which
// is what keeps one request's files out of another's, and can be created as a
// file under any directory.
const isProjectRelativePath = (path: string) =>
  path.length > 0 &&
  !path.includes("\\") &&
  !hasControlCharacter(path) &&
  path
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        textEncoder.encode(segment).length <= MAX_SEGMENT_BYTES,
    );

// Every directory some key lives under (for `a/b/c`: `a` and `a/b`). A key
// that is also in this set can't be written to disk as both a file and a
// directory.
const directoriesOf = (paths: string[]) => {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return directories;
};

// The entrypoint as callers send it: absent, `` or `.` for the root, else a
// relative directory, which may carry a leading `./` or a trailing `/`. Null
// when it's not a string, is absolute, or isn't a clean relative path.
const normalizeEntrypoint = (value: unknown): string | null => {
  if (value === undefined) {
    return ".";
  }
  if (typeof value !== "string") {
    return null;
  }
  let dir = value;
  while (dir.startsWith("./")) {
    dir = dir.slice(2);
  }
  if (dir.startsWith("/")) {
    return null;
  }
  while (dir.endsWith("/")) {
    dir = dir.slice(0, -1);
  }
  if (dir === "" || dir === ".") {
    return ".";
  }
  return isProjectRelativePath(dir) ? dir : null;
};

const projectPath = (entrypoint: string, file: string) =>
  entrypoint === "." ? file : `${entrypoint}/${file}`;

// The `[package] name` of a TOML manifest, `Cargo.toml` or
// `miden-project.toml`, or why there is none: the file isn't TOML, or it has
// no `[package]` (a workspace root only lists members).
const readPackageName = (
  manifest: string,
): { name: string } | { error: "invalid toml" | "no package" } => {
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(manifest);
  } catch {
    return { error: "invalid toml" };
  }
  const manifestPackage = parsed.package;
  const name =
    typeof manifestPackage === "object" && manifestPackage !== null
      ? (manifestPackage as { name?: unknown }).name
      : undefined;
  return typeof name === "string" ? { name } : { error: "no package" };
};

// The reason a manifest at `path` names no package, worded for the client.
const packageError = (path: string, error: "invalid toml" | "no package") =>
  error === "invalid toml" ? `${path} is not valid TOML` : `${path} has no [package]`;

// The `[package] name` of a Cargo.toml, undefined when it has none or doesn't
// parse. For callers that only match crates by name.
export const cargoPackageName = (cargoToml: string) => {
  const cargoPackage = readPackageName(cargoToml);
  return "name" in cargoPackage ? cargoPackage.name : undefined;
};

// The `[package] name` and `[lib] path` of a `miden-project.toml`: the
// package and the module its library target is built from, relative to the
// manifest's directory, with no leading `./`. Undefined when the manifest has
// no `[package]` or doesn't parse; `libPath` is undefined when it names no
// `[lib] path`. For callers that open a MASM project's root module.
export const midenProjectLibrary = (
  midenProjectToml: string,
): { name: string; libPath: string | undefined } | undefined => {
  const masmPackage = readPackageName(midenProjectToml);
  if ("error" in masmPackage) {
    return undefined;
  }
  // Parsed again: `readPackageName` keeps only the name.
  const lib = (parse(midenProjectToml) as { lib?: unknown }).lib;
  const path =
    typeof lib === "object" && lib !== null ? (lib as { path?: unknown }).path : undefined;
  const libPath = typeof path === "string" ? path.replace(/^(?:\.\/)+/, "") : "";
  return {
    name: masmPackage.name,
    libPath: libPath === "" ? undefined : libPath,
  };
};

// Opens the project a client submitted: `files` and `entrypoint` as they came
// in the request body. The reasons it can refuse, in the order checked:
// `missing files`, `invalid file path: <path>`, `invalid file content: <path>`,
// `invalid entrypoint`, then for a Rust project `missing miden-project.toml`,
// `<path>/Cargo.toml is not valid TOML`, `<path>/Cargo.toml has no [package]`,
// and for a MASM project `missing miden-project.toml`,
// `<path>/miden-project.toml is not valid TOML`,
// `<path>/miden-project.toml has no [package]`.
//
// MASM projects are opened only with `masm: true`, which api-compile and the
// registry pass; without it a files map with no `Cargo.toml` at its
// entrypoint is refused with `missing Cargo.toml`, as before MASM projects
// existed.
export const openProject = (
  files: unknown,
  entrypoint?: unknown,
  { masm = false }: { masm?: boolean } = {},
): ProjectResult => {
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return { error: "missing files" };
  }
  const directories = directoriesOf(Object.keys(files));
  for (const [path, content] of Object.entries(files)) {
    if (!isProjectRelativePath(path) || directories.has(path)) {
      return { error: `invalid file path: ${path}` };
    }
    if (typeof content !== "string") {
      return { error: `invalid file content: ${path}` };
    }
  }
  const projectFiles = files as Record<string, string>;
  const dir = normalizeEntrypoint(entrypoint);
  if (dir === null) {
    return { error: "invalid entrypoint" };
  }
  const fileAt = (path: string) =>
    Object.hasOwn(projectFiles, path) ? projectFiles[path] : undefined;
  const cargoTomlPath = projectPath(dir, CARGO_TOML);
  const midenProjectTomlPath = projectPath(dir, MIDEN_PROJECT_TOML);
  const cargoToml = fileAt(cargoTomlPath);
  const midenProjectToml = fileAt(midenProjectTomlPath);
  if (cargoToml === undefined) {
    if (!masm) {
      return { error: `missing ${CARGO_TOML}` };
    }
    if (midenProjectToml === undefined) {
      return { error: `missing ${MIDEN_PROJECT_TOML}` };
    }
    const masmPackage = readPackageName(midenProjectToml);
    if ("error" in masmPackage) {
      return { error: packageError(midenProjectTomlPath, masmPackage.error) };
    }
    return {
      project: {
        files: projectFiles,
        entrypoint: dir,
        name: masmPackage.name,
        kind: "masm",
      },
    };
  }
  if (midenProjectToml === undefined) {
    return { error: `missing ${MIDEN_PROJECT_TOML}` };
  }
  const cargoPackage = readPackageName(cargoToml);
  if ("error" in cargoPackage) {
    return { error: packageError(cargoTomlPath, cargoPackage.error) };
  }
  return {
    project: {
      files: projectFiles,
      entrypoint: dir,
      name: cargoPackage.name,
      kind: "rust",
    },
  };
};

// The kind of a project the registry stored: Rust when its `files` hold a
// `Cargo.toml` at its entrypoint, MASM otherwise. A project stored before its
// entrypoint was recorded (`null`) is a Rust one: MASM projects came later.
export const storedProjectKind = (
  files: Record<string, string>,
  entrypoint: string | null,
): ProjectKind =>
  entrypoint === null || Object.hasOwn(files, projectPath(entrypoint, CARGO_TOML))
    ? "rust"
    : "masm";

// The inverse of `openProject` for a project stored before its entrypoint was
// recorded: the one entrypoint in `files` whose `Cargo.toml` names `name` and
// has a `miden-project.toml` next to it. Null when none or several do.
export const inferEntrypoint = (files: Record<string, string>, name: string) => {
  const entrypoints = Object.keys(files).flatMap((path) => {
    if (path !== CARGO_TOML && !path.endsWith(`/${CARGO_TOML}`)) {
      return [];
    }
    const dir = path === CARGO_TOML ? "." : path.slice(0, -(CARGO_TOML.length + 1));
    const cargoToml = files[path];
    const isProject =
      cargoToml !== undefined &&
      Object.hasOwn(files, projectPath(dir, MIDEN_PROJECT_TOML)) &&
      cargoPackageName(cargoToml) === name;
    return isProject ? [dir] : [];
  });
  return entrypoints.length === 1 ? (entrypoints[0] ?? null) : null;
};
