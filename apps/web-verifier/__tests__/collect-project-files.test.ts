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

describe("selectProjectFiles on MASM projects", () => {
  it("keeps only the manifest and the MASM files of a single MASM project", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "counter-contract/miden-project.toml",
      "counter-contract/counter_contract.masm",
      "counter-contract/README.md",
      "counter-contract/src/notes.txt",
      "counter-contract/target/counter_contract.masp",
    ]);
    expect(includedPaths).toEqual([
      "miden-project.toml",
      "counter_contract.masm",
    ]);
    expect(entrypoints).toEqual(["."]);
  });

  it("keeps MASM sources outside src/, inside the project or above it", () => {
    const { includedPaths } = selectProjectFiles([
      "project/shared/math.masm",
      "project/counter/miden-project.toml",
      "project/counter/asm/account/counter.masm",
      "project/counter/asm/account/notes.md",
    ]);
    expect(includedPaths).toEqual([
      "shared/math.masm",
      "counter/miden-project.toml",
      "counter/asm/account/counter.masm",
    ]);
  });

  it("lists a note and the account it depends on by path as entrypoints", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "masm/counter-contract/miden-project.toml",
      "masm/counter-contract/counter_contract.masm",
      "masm/counter-note/miden-project.toml",
      "masm/counter-note/counter_note.masm",
    ]);
    expect(includedPaths).toEqual([
      "counter-contract/miden-project.toml",
      "counter-contract/counter_contract.masm",
      "counter-note/miden-project.toml",
      "counter-note/counter_note.masm",
    ]);
    expect(entrypoints).toEqual(["counter-contract", "counter-note"]);
  });

  it("applies each project's own rules in a mixed folder", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "mixed/rust-account/Cargo.toml",
      "mixed/rust-account/miden-project.toml",
      "mixed/rust-account/src/lib.rs",
      "mixed/rust-account/stray.masm",
      "mixed/masm-note/miden-project.toml",
      "mixed/masm-note/note.masm",
      "mixed/masm-note/build.rs",
      "mixed/masm-note/src/lib.rs",
    ]);
    expect(includedPaths).toEqual([
      "rust-account/Cargo.toml",
      "rust-account/miden-project.toml",
      "rust-account/src/lib.rs",
      "rust-account/stray.masm",
      "masm-note/miden-project.toml",
      "masm-note/note.masm",
    ]);
    expect(entrypoints).toEqual(["masm-note", "rust-account"]);
  });

  it("gives a MASM project nested in a Rust workspace the MASM rules, root not listed", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "ws/Cargo.toml",
      "ws/src/lib.rs",
      "ws/masm/miden-project.toml",
      "ws/masm/src/extra.rs",
      "ws/masm/lib.masm",
    ]);
    expect(includedPaths).toEqual([
      "Cargo.toml",
      "src/lib.rs",
      "masm/miden-project.toml",
      "masm/lib.masm",
    ]);
    expect(entrypoints).toEqual(["masm"]);
  });

  it("lists the root first when it holds a miden-project.toml", () => {
    const { entrypoints } = selectProjectFiles([
      "note/miden-project.toml",
      "note/note.masm",
      "note/account/miden-project.toml",
      "note/account/account.masm",
    ]);
    expect(entrypoints).toEqual([".", "account"]);
  });

  it("ignores manifests under target and hidden directories", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "masm/target/pkg/miden-project.toml",
      "masm/.git/pkg/miden-project.toml",
      "masm/pkg/miden-project.toml",
      "masm/pkg/pkg.masm",
    ]);
    expect(includedPaths).toEqual(["pkg/miden-project.toml", "pkg/pkg.masm"]);
    expect(entrypoints).toEqual(["pkg"]);
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

  it("reads a MASM project as text", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/miden-project.toml"),
      new File(["pub proc get_count"], "counter/counter.masm"),
      new File(["# readme"], "counter/README.md"),
    ]);
    expect(result).toEqual({
      files: {
        "counter.masm": "pub proc get_count",
        "miden-project.toml": "[package]",
      },
      entrypoints: ["."],
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
