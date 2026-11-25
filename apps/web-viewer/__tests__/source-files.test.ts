import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  filterSourceFiles,
  findEntryFile,
  packageMaspUrl,
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

const midenProjectToml = (name: string, path?: string) =>
  `[package]\nname = "${name}"\nversion = "0.1.0"\n${
    path ? `\n[lib]\nkind = "note"\npath = "${path}"\n` : ""
  }`;

// A MASM note uploaded with the account component it depends on by path.
const masmNoteWithDependency = {
  "counter-contract/counter_contract.masm": "",
  "counter-contract/miden-project.toml": midenProjectToml(
    "counter-contract",
    "counter_contract.masm",
  ),
  "counter-note/counter_note.masm": "",
  "counter-note/lib/helpers.masm": "",
  "counter-note/miden-project.toml": midenProjectToml("counter-note", "./counter_note.masm"),
  "counter-note/notes.txt": "",
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
    expect(Object.keys(filterSourceFiles(files))).toEqual(["src/storage/mod.rs"]);
  });
});

describe("filterSourceFiles of a MASM project", () => {
  it("keeps the manifests and every MASM module, at any depth", () => {
    expect(Object.keys(filterSourceFiles(masmNoteWithDependency)).sort()).toEqual([
      "counter-contract/counter_contract.masm",
      "counter-contract/miden-project.toml",
      "counter-note/counter_note.masm",
      "counter-note/lib/helpers.masm",
      "counter-note/miden-project.toml",
    ]);
  });
});

describe("findEntryFile", () => {
  it("opens the lib.rs of a project uploaded on its own", () => {
    expect(findEntryFile(filterSourceFiles(rootProject), "counter-contract")).toBe("src/lib.rs");
  });

  it("opens the lib.rs of the crate named after the package", () => {
    const files = filterSourceFiles(noteWithDependency);
    expect(findEntryFile(files, "counter-note")).toBe("counter-note/src/lib.rs");
  });

  it("matches the package name exactly, not up to - and _", () => {
    const files = filterSourceFiles(noteWithDependency);
    expect(findEntryFile(files, "counter_note")).toBe("counter-contract/src/lib.rs");
  });

  it("falls back to the first lib.rs when no crate is named after the package", () => {
    expect(findEntryFile(filterSourceFiles(noteWithDependency), "counter-account")).toBe(
      "counter-contract/src/lib.rs",
    );
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
    expect(findEntryFile({ "src/main.rs": "", "Cargo.toml": "" }, "x")).toBe("Cargo.toml");
    expect(findEntryFile({}, "x")).toBeNull();
  });
});

describe("findEntryFile of a MASM project", () => {
  const files = filterSourceFiles(masmNoteWithDependency);

  it("opens the [lib] path of the project named after the package", () => {
    expect(findEntryFile(files, "counter-note")).toBe("counter-note/counter_note.masm");
    expect(findEntryFile(files, "counter-contract")).toBe("counter-contract/counter_contract.masm");
  });

  it("resolves a [lib] path outside the manifest's directory", () => {
    expect(
      findEntryFile(
        {
          "counter-note/miden-project.toml": midenProjectToml(
            "counter-note",
            "../shared/./note.masm",
          ),
          "counter-note/a.masm": "",
          "shared/note.masm": "",
        },
        "counter-note",
      ),
    ).toBe("shared/note.masm");
  });

  it("opens a project at the root", () => {
    expect(
      findEntryFile(
        {
          "miden-project.toml": midenProjectToml("counter-note", "main.masm"),
          "main.masm": "",
          "a.masm": "",
        },
        "counter-note",
      ),
    ).toBe("main.masm");
  });

  it("falls back to the first MASM module without a match or a [lib] path", () => {
    expect(findEntryFile(files, "counter-account")).toBe("counter-contract/counter_contract.masm");
    expect(
      findEntryFile(
        {
          "miden-project.toml": midenProjectToml("counter-note"),
          "main.masm": "",
        },
        "counter-note",
      ),
    ).toBe("main.masm");
  });

  it("reads a miden-project.toml beside a Cargo.toml as a Rust project's", () => {
    expect(
      findEntryFile(
        {
          "Cargo.toml": cargoToml("counter-contract"),
          "miden-project.toml": midenProjectToml("counter-contract", "lib.masm"),
          "lib.masm": "",
          "src/lib.rs": "",
        },
        "counter-contract",
      ),
    ).toBe("src/lib.rs");
  });
});

describe("buildFileTree", () => {
  it("nests paths, folders first and then alphabetically", () => {
    expect(
      buildFileTree(["src/lib.rs", "miden-project.toml", "src/storage/mod.rs", "Cargo.toml"]),
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

  it("prefixes a Mainnet package with mm", () => {
    expect(
      sourcesArchiveName({
        networkId: "mm",
        id: "0xe69e6ca6e39df1b10c1e5399399feb",
        packageName: "counter-account",
      }),
    ).toBe("mm-0xe69e6ca6-counter-account.zip");
  });
});

describe("packageMaspUrl", () => {
  const commitment = `0x${"ab".repeat(32)}`;

  it("points at the registry's .masp for the commitment", () => {
    expect(packageMaspUrl({ networkId: "mtst", commitment })).toBe(
      `http://localhost:8081/v1/mtst/packages/masp/${commitment}.masp`,
    );
  });

  it("points at its .debug.masp for the debug build", () => {
    expect(packageMaspUrl({ networkId: "mtst", commitment, variant: "debug" })).toBe(
      `http://localhost:8081/v1/mtst/packages/masp/${commitment}.debug.masp`,
    );
  });
});
