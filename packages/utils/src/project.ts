import { parse } from "smol-toml";

// A Project (see GLOSSARY.md): a files map plus an entrypoint that builds into
// one package. Keys are project-relative paths. A project is a MASM project: a
// `miden-project.toml` with a `[package]` at its entrypoint, which the
// assembler builds. A `Cargo.toml` at the entrypoint marks a Rust project,
// which is refused. This module is the only reader of `miden-project.toml` in
// the repo, and the one place that says why a submitted files map isn't a
// project.
export type Project = {
  files: Record<string, string>;
  // `.` for the root, otherwise a relative directory with no leading `./` and
  // no trailing `/`.
  entrypoint: string;
  // The `[package] name` of the entrypoint's `miden-project.toml`.
  name: string;
};

// Why a project with a `Cargo.toml` at its entrypoint is refused. The released
// `miden verify` CLI uploads Rust projects and prints the registry's answer as
// is, so the message is written for its users too.
export const RUST_PROJECT_ERROR =
  "Rust projects are no longer verified. Miden projects are written in MASM: upload a `miden-project.toml` project. If you use the `miden verify` CLI, upgrade to 0.8.0 or later.";

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

// The `[package] name` of a `miden-project.toml`, or why there is none: the
// file isn't TOML, or it has no `[package]` (a workspace root only lists
// members).
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
// `invalid entrypoint`, `RUST_PROJECT_ERROR` for a `Cargo.toml` at the
// entrypoint, `missing miden-project.toml`,
// `<path>/miden-project.toml is not valid TOML`,
// `<path>/miden-project.toml has no [package]`.
export const openProject = (files: unknown, entrypoint?: unknown): ProjectResult => {
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
  if (Object.hasOwn(projectFiles, projectPath(dir, CARGO_TOML))) {
    return { error: RUST_PROJECT_ERROR };
  }
  const midenProjectTomlPath = projectPath(dir, MIDEN_PROJECT_TOML);
  const midenProjectToml = Object.hasOwn(projectFiles, midenProjectTomlPath)
    ? projectFiles[midenProjectTomlPath]
    : undefined;
  if (midenProjectToml === undefined) {
    return { error: `missing ${MIDEN_PROJECT_TOML}` };
  }
  const masmPackage = readPackageName(midenProjectToml);
  if ("error" in masmPackage) {
    return { error: packageError(midenProjectTomlPath, masmPackage.error) };
  }
  return { project: { files: projectFiles, entrypoint: dir, name: masmPackage.name } };
};
