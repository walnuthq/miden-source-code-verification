import { describe, expect, it } from "vitest";

import {
  collectProjectFiles,
  MAX_PROJECT_BYTES,
  RUST_FOLDER_ERROR,
  selectProjectFiles,
} from "@/lib/collect-project-files";

describe("selectProjectFiles", () => {
  it("keeps only the manifest and the MASM files of a single project", () => {
    const { includedPaths, entrypoints, isRustProject } = selectProjectFiles([
      "counter-contract/miden-project.toml",
      "counter-contract/counter_contract.masm",
      "counter-contract/README.md",
      "counter-contract/src/notes.txt",
      "counter-contract/target/counter_contract.masp",
    ]);
    expect(includedPaths).toEqual(["miden-project.toml", "counter_contract.masm"]);
    expect(entrypoints).toEqual(["."]);
    expect(isRustProject).toBe(false);
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

  it("drops a Rust project's files from a folder that also holds a MASM project", () => {
    const { includedPaths, entrypoints, isRustProject } = selectProjectFiles([
      "mixed/rust-account/Cargo.toml",
      "mixed/rust-account/Cargo.lock",
      "mixed/rust-account/src/lib.rs",
      "mixed/masm-note/miden-project.toml",
      "mixed/masm-note/note.masm",
    ]);
    expect(includedPaths).toEqual(["masm-note/miden-project.toml", "masm-note/note.masm"]);
    expect(entrypoints).toEqual(["masm-note"]);
    expect(isRustProject).toBe(false);
  });

  it("calls a folder with a Cargo.toml and no miden-project.toml a Rust project", () => {
    expect(selectProjectFiles(["counter/Cargo.toml", "counter/src/lib.rs"]).isRustProject).toBe(
      true,
    );
    expect(
      selectProjectFiles(["ws/Cargo.toml", "ws/contract/Cargo.toml", "ws/contract/src/lib.rs"])
        .isRustProject,
    ).toBe(true);
    expect(selectProjectFiles(["counter/README.md"]).isRustProject).toBe(false);
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

  it("ignores files under target and hidden directories", () => {
    const { includedPaths, entrypoints } = selectProjectFiles([
      "masm/target/pkg/miden-project.toml",
      "masm/.git/pkg/miden-project.toml",
      "masm/.cargo/lib.masm",
      "masm/pkg/miden-project.toml",
      "masm/pkg/pkg.masm",
    ]);
    expect(includedPaths).toEqual(["pkg/miden-project.toml", "pkg/pkg.masm"]);
    expect(entrypoints).toEqual(["pkg"]);
  });
});

describe("collectProjectFiles", () => {
  it("reads a project as text", async () => {
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

  it("refuses a Rust project", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/Cargo.toml"),
      new File(["fn main() {}"], "counter/src/lib.rs"),
    ]);
    expect(result).toEqual({ error: RUST_FOLDER_ERROR });
  });

  it("refuses a folder larger than the verifier accepts", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/miden-project.toml"),
      // Not UTF-8: if it were read first, the result would be the not-text error.
      new File([new Uint8Array(MAX_PROJECT_BYTES + 1).fill(0xff)], "counter/counter.masm"),
    ]);
    expect(result).toEqual({
      error: "The selected project is larger than 1 MB, the most the verifier accepts.",
    });
  });

  it("does not count files that are not kept", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/miden-project.toml"),
      new File([new Uint8Array(2_000_000)], "counter/target/big.bin"),
    ]);
    expect(result).toEqual({
      files: { "miden-project.toml": "[package]" },
      entrypoints: ["."],
    });
  });

  it("refuses a file that isn't text, naming it", async () => {
    const result = await collectProjectFiles([
      new File(["[package]"], "counter/miden-project.toml"),
      new File([new Uint8Array([0xff, 0xfe, 0x00])], "counter/lib/logo.masm"),
    ]);
    expect(result).toEqual({ error: "lib/logo.masm is not a UTF-8 text file." });
  });
});
