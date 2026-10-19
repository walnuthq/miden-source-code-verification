import { posix } from "node:path";
import {
  type CargoToml,
  parseCargoToml,
} from "miden-source-code-verification-utils";

const packageName = (cargoToml: string) => {
  try {
    // A workspace manifest has no `[package]`.
    return (parseCargoToml(cargoToml) as Partial<CargoToml>).package?.name;
  } catch {
    return undefined;
  }
};

// The `entrypoint` a package named `name` was built from, for packages stored
// before it was recorded: the directory of the one `Cargo.toml` in `files`
// whose `[package] name` is `name` and that has a `miden-project.toml` next to
// it (`.` at the root). Null when none or several match.
export const inferEntrypoint = (
  files: Record<string, string>,
  name: string,
) => {
  const entrypoints = Object.entries(files).flatMap(([path, content]) => {
    if (posix.basename(path) !== "Cargo.toml") {
      return [];
    }
    const dir = posix.dirname(path);
    const isProject =
      posix.join(dir, "miden-project.toml") in files &&
      packageName(content) === name;
    return isProject ? [dir] : [];
  });
  return entrypoints.length === 1 ? (entrypoints[0] ?? null) : null;
};
