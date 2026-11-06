import { parse } from "smol-toml";

// A Project (see GLOSSARY.md): a files map plus an entrypoint that cargo-miden
// can build into one package. Keys are project-relative paths; at the
// entrypoint sit a `Cargo.toml` with a `[package]` and a `miden-project.toml`.
// This module is the only reader of `Cargo.toml` in the repo, and the one
// place that says why a submitted files map isn't a project.
export type Project = {
  files: Record<string, string>;
  // `.` for the root, otherwise a relative directory with no leading `./` and
  // no trailing `/`.
  entrypoint: string;
  // The `[package] name` of the entrypoint's `Cargo.toml`.
  name: string;
};

// `error` is the reason a files map isn't a project, worded for the client:
// the routes answer it as a 400 as is.
export type ProjectResult = { project: Project } | { error: string };

const CARGO_TOML = "Cargo.toml";
const MIDEN_PROJECT_TOML = "miden-project.toml";

// A clean project-relative path: `/`-separated segments, none of them empty,
// `.` or `..`, and no backslash. Every such path written under a directory
// stays under it, which is what keeps one request's files out of another's.
const isProjectRelativePath = (path: string) =>
  path.length > 0 &&
  !path.includes("\\") &&
  path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

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

// The `[package] name` of a Cargo.toml, or why there is none: the file isn't
// TOML, or it has no `[package]` (a workspace root only lists members).
const readCargoPackage = (
  cargoToml: string,
): { name: string } | { error: "invalid toml" | "no package" } => {
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(cargoToml);
  } catch {
    return { error: "invalid toml" };
  }
  const cargoPackage = parsed.package;
  const name =
    typeof cargoPackage === "object" && cargoPackage !== null
      ? (cargoPackage as { name?: unknown }).name
      : undefined;
  return typeof name === "string" ? { name } : { error: "no package" };
};

// The `[package] name` of a Cargo.toml, undefined when it has none or doesn't
// parse. For callers that only match crates by name.
export const cargoPackageName = (cargoToml: string) => {
  const cargoPackage = readCargoPackage(cargoToml);
  return "name" in cargoPackage ? cargoPackage.name : undefined;
};

// Opens the project a client submitted: `files` and `entrypoint` as they came
// in the request body. The reasons it can refuse, in the order checked:
// `missing files`, `invalid file path: <path>`, `invalid file content: <path>`,
// `invalid entrypoint`, `missing Cargo.toml`, `missing miden-project.toml`,
// `<path>/Cargo.toml is not valid TOML`, `<path>/Cargo.toml has no [package]`.
export const openProject = (
  files: unknown,
  entrypoint?: unknown,
): ProjectResult => {
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return { error: "missing files" };
  }
  for (const [path, content] of Object.entries(files)) {
    if (!isProjectRelativePath(path)) {
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
  const cargoTomlPath = projectPath(dir, CARGO_TOML);
  const cargoToml = Object.hasOwn(projectFiles, cargoTomlPath)
    ? projectFiles[cargoTomlPath]
    : undefined;
  if (cargoToml === undefined) {
    return { error: `missing ${CARGO_TOML}` };
  }
  if (!Object.hasOwn(projectFiles, projectPath(dir, MIDEN_PROJECT_TOML))) {
    return { error: `missing ${MIDEN_PROJECT_TOML}` };
  }
  const cargoPackage = readCargoPackage(cargoToml);
  if ("error" in cargoPackage) {
    return {
      error:
        cargoPackage.error === "invalid toml"
          ? `${cargoTomlPath} is not valid TOML`
          : `${cargoTomlPath} has no [package]`,
    };
  }
  return {
    project: { files: projectFiles, entrypoint: dir, name: cargoPackage.name },
  };
};

// The inverse of `openProject` for a project stored before its entrypoint was
// recorded: the one entrypoint in `files` whose `Cargo.toml` names `name` and
// has a `miden-project.toml` next to it. Null when none or several do.
export const inferEntrypoint = (
  files: Record<string, string>,
  name: string,
) => {
  const entrypoints = Object.keys(files).flatMap((path) => {
    if (path !== CARGO_TOML && !path.endsWith(`/${CARGO_TOML}`)) {
      return [];
    }
    const dir =
      path === CARGO_TOML ? "." : path.slice(0, -(CARGO_TOML.length + 1));
    const cargoToml = files[path];
    const isProject =
      cargoToml !== undefined &&
      Object.hasOwn(files, projectPath(dir, MIDEN_PROJECT_TOML)) &&
      cargoPackageName(cargoToml) === name;
    return isProject ? [dir] : [];
  });
  return entrypoints.length === 1 ? (entrypoints[0] ?? null) : null;
};
