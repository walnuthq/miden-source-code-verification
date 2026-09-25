import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  filterSourceFiles,
  findEntryFile,
  sourcesArchiveName,
} from "@/lib/source-files";

const cargoToml = (name: string) =>
  `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;

// A project uploaded on its own: paths relative to the crate root.
const rootProject = {
  ".cargo/config.toml": "",
  "Cargo.lock": "",
  "Cargo.toml": cargoToml("counter-contract"),
  "build.rs": "",
  "miden-project.toml": "",
  "rust-toolchain.toml": "",
  "src/lib.rs": "",
};

// A note uploaded with its local dependency: paths prefixed by each crate's dir.
const noteWithDependency = {
  "counter-contract/.cargo/config.toml": "",
  "counter-contract/Cargo.toml": cargoToml("counter-contract"),
  "counter-contract/build.rs": "",
  "counter-contract/miden-project.toml": "",
  "counter-contract/src/lib.rs": "",
  "counter-note/Cargo.lock": "",
  "counter-note/Cargo.toml": cargoToml("counter-note"),
  "counter-note/miden-project.toml": "",
  "counter-note/rust-toolchain.toml": "",
  "counter-note/src/lib.rs": "",
};

describe("filterSourceFiles", () => {
  it("keeps the manifests and the Rust sources under src/", () => {
    expect(Object.keys(filterSourceFiles(rootProject)).sort()).toEqual([
      "Cargo.toml",
      "miden-project.toml",
      "src/lib.rs",
    ]);
  });

  it("matches them under a project dir prefix", () => {
    expect(Object.keys(filterSourceFiles(noteWithDependency)).sort()).toEqual([
      "counter-contract/Cargo.toml",
      "counter-contract/miden-project.toml",
      "counter-contract/src/lib.rs",
      "counter-note/Cargo.toml",
      "counter-note/miden-project.toml",
      "counter-note/src/lib.rs",
    ]);
  });

  it("keeps nested Rust modules but drops other files under src/", () => {
    const files = {
      "src/storage/mod.rs": "",
      "src/data.json": "",
      "tests/counter.rs": "",
    };
    expect(Object.keys(filterSourceFiles(files))).toEqual([
      "src/storage/mod.rs",
    ]);
  });
});

describe("findEntryFile", () => {
  it("opens the lib.rs of a project uploaded on its own", () => {
    expect(
      findEntryFile(filterSourceFiles(rootProject), "counter-contract"),
    ).toBe("src/lib.rs");
  });

  it("opens the lib.rs of the crate named after the package", () => {
    const files = filterSourceFiles(noteWithDependency);
    expect(findEntryFile(files, "counter-note")).toBe(
      "counter-note/src/lib.rs",
    );
    expect(findEntryFile(files, "counter_note")).toBe(
      "counter-note/src/lib.rs",
    );
  });

  it("falls back to the first lib.rs when no crate is named after the package", () => {
    expect(
      findEntryFile(filterSourceFiles(noteWithDependency), "counter-account"),
    ).toBe("counter-contract/src/lib.rs");
  });

  it("skips manifests that don't parse", () => {
    const files = {
      "a/Cargo.toml": "not [valid toml",
      "a/src/lib.rs": "",
      "b/Cargo.toml": cargoToml("b"),
      "b/src/lib.rs": "",
    };
    expect(findEntryFile(files, "b")).toBe("b/src/lib.rs");
  });

  it("falls back to the first file, or null without files", () => {
    expect(findEntryFile({ "src/main.rs": "", "Cargo.toml": "" }, "x")).toBe(
      "Cargo.toml",
    );
    expect(findEntryFile({}, "x")).toBeNull();
  });
});

describe("buildFileTree", () => {
  it("nests paths, folders first and then alphabetically", () => {
    expect(
      buildFileTree([
        "src/lib.rs",
        "miden-project.toml",
        "src/storage/mod.rs",
        "Cargo.toml",
      ]),
    ).toEqual([
      {
        name: "src",
        path: "src",
        children: [
          {
            name: "storage",
            path: "src/storage",
            children: [{ name: "mod.rs", path: "src/storage/mod.rs" }],
          },
          { name: "lib.rs", path: "src/lib.rs" },
        ],
      },
      { name: "Cargo.toml", path: "Cargo.toml" },
      { name: "miden-project.toml", path: "miden-project.toml" },
    ]);
  });
});

describe("sourcesArchiveName", () => {
  it("prefixes the package with the network and the ID's first 10 chars", () => {
    expect(
      sourcesArchiveName({
        networkId: "mtst",
        id: "0xad41ad8e6776a19173668f043fc081",
        packageName: "counter-contract",
      }),
    ).toBe("mtst-0xad41ad8e-counter-contract.zip");
  });
});
