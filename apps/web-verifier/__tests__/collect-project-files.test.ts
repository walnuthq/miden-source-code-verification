import { describe, expect, it } from "vitest";

import {
  collectProjectFiles,
  MAX_PROJECT_BYTES,
  selectProjectFiles,
} from "@/lib/collect-project-files";

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

describe("collectProjectFiles", () => {
  it("reads the kept files as text", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/Cargo.toml"),
      new File(["fn main() {}"], "counter/src/lib.rs"),
      new File(["# readme"], "counter/README.md"),
    ]);
    expect(result).toEqual({
      files: { "Cargo.toml": "[package]", "src/lib.rs": "fn main() {}" },
      entrypoints: [],
    });
  });

  it("refuses a folder larger than the verifier accepts", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/Cargo.toml"),
      // Not UTF-8: if it were read first, the result would be the not-text error.
      new File(
        [new Uint8Array(MAX_PROJECT_BYTES + 1).fill(0xff)],
        "counter/src/lib.rs",
      ),
    ]);
    expect(result).toEqual({
      error:
        "The selected project is larger than 1 MB, the most the verifier accepts.",
    });
  });

  it("does not count files that are not kept", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/Cargo.toml"),
      new File([new Uint8Array(2_000_000)], "counter/target/big.bin"),
    ]);
    expect(result).toEqual({
      files: { "Cargo.toml": "[package]" },
      entrypoints: [],
    });
  });

  it("refuses a file that isn't text, naming it", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/Cargo.toml"),
      new File([new Uint8Array([0xff, 0xfe, 0x00])], "counter/src/logo.png"),
    ]);
    expect(result).toEqual({ error: "src/logo.png is not a UTF-8 text file." });
  });
});
