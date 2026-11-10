import { describe, expect, it } from "vitest";

import { selectProjectFiles } from "@/lib/collect-project-files";

describe("selectProjectFiles", () => {
  it("keeps the build inputs and sources with the root folder name stripped", () => {
    const { includedPaths } = selectProjectFiles([
      "counter/Cargo.toml",
      "counter/Cargo.lock",
      "counter/build.rs",
      "counter/miden-project.toml",
      "counter/rust-toolchain.toml",
      "counter/.cargo/config.toml",
      "counter/src/lib.rs",
      "counter/src/nested/mod.rs",
    ]);
    expect(includedPaths).toEqual([
      "Cargo.toml",
      "Cargo.lock",
      "build.rs",
      "miden-project.toml",
      "rust-toolchain.toml",
      ".cargo/config.toml",
      "src/lib.rs",
      "src/nested/mod.rs",
    ]);
  });

  it("drops files that are not build inputs", () => {
    const { includedPaths } = selectProjectFiles([
      "counter/README.md",
      "counter/config.toml",
      "counter/Cargo.toml",
    ]);
    expect(includedPaths).toEqual(["Cargo.toml"]);
  });

  it("prunes everything under target", () => {
    const { includedPaths } = selectProjectFiles([
      "counter/target/debug/src/x.rs",
      "counter/target/Cargo.toml",
      "counter/src/lib.rs",
    ]);
    expect(includedPaths).toEqual(["src/lib.rs"]);
  });

  it("prunes hidden directories but not .cargo", () => {
    // Paths that would be kept anywhere else, so only the pruning drops them.
    const { includedPaths, entrypoints } = selectProjectFiles([
      "counter/.git/src/lib.rs",
      "counter/.hidden/Cargo.toml",
      "counter/.cargo/config.toml",
    ]);
    expect(includedPaths).toEqual([".cargo/config.toml"]);
    expect(entrypoints).toEqual([]);
  });

  it("lists the directories directly holding a Cargo.toml as sorted entrypoints, root excluded", () => {
    const { entrypoints } = selectProjectFiles([
      "counter/Cargo.toml",
      "counter/b/Cargo.toml",
      "counter/a/Cargo.toml",
    ]);
    expect(entrypoints).toEqual(["a", "b"]);
  });
});
