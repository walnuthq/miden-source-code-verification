import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  filterSourceFiles,
  findEntryFile,
  packageMaspUrl,
  sourcesArchiveName,
} from "@/lib/source-files";

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
  it("keeps the manifests and every MASM module, at any depth", () => {
    expect(Object.keys(filterSourceFiles(masmNoteWithDependency)).sort()).toEqual([
      "counter-contract/counter_contract.masm",
      "counter-contract/miden-project.toml",
      "counter-note/counter_note.masm",
      "counter-note/lib/helpers.masm",
      "counter-note/miden-project.toml",
    ]);
  });

  it("drops what a Rust project held", () => {
    expect(
      Object.keys(
        filterSourceFiles({
          "Cargo.toml": "",
          "Cargo.lock": "",
          "src/lib.rs": "",
          "miden-project.toml": "",
          "lib.masm": "",
        }),
      ),
    ).toEqual(["miden-project.toml", "lib.masm"]);
  });
});

describe("findEntryFile", () => {
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

  it("falls back to the first file, or null without files", () => {
    expect(findEntryFile({ "miden-project.toml": "" }, "x")).toBe("miden-project.toml");
    expect(findEntryFile({}, "x")).toBeNull();
  });
});

describe("buildFileTree", () => {
  it("nests paths, folders first and then alphabetically", () => {
    expect(
      buildFileTree([
        "asm/lib.masm",
        "miden-project.toml",
        "asm/account/counter.masm",
        "counter.masm",
      ]),
    ).toEqual([
      {
        name: "asm",
        path: "asm",
        children: [
          {
            name: "account",
            path: "asm/account",
            children: [{ name: "counter.masm", path: "asm/account/counter.masm" }],
          },
          { name: "lib.masm", path: "asm/lib.masm" },
        ],
      },
      { name: "counter.masm", path: "counter.masm" },
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
});
