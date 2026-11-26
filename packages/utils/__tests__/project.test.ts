import { describe, expect, it } from "vitest";

import {
  cargoPackageName,
  midenProjectLibrary,
  openProject,
  RUST_PROJECT_ERROR,
  storedProjectKind,
} from "../src/project.ts";

const cargoToml = (name: string) => `[package]\nname = "${name}"\n`;

const midenProjectToml = (name: string) => `[package]\nname = "${name}"\nversion = "0.1.0"\n`;

const masmRoot = {
  "miden-project.toml": midenProjectToml("counter-account"),
  "counter_account.masm": "",
};

const masmProject = {
  "counter-account/miden-project.toml": midenProjectToml("counter-account"),
  "counter-account/counter_account.masm": "",
  "increment-note/miden-project.toml": midenProjectToml("increment-note"),
  "increment-note/increment_note.masm": "",
};

describe("openProject", () => {
  it("opens a project at the root, named by its miden-project.toml", () => {
    expect(openProject(masmRoot)).toEqual({
      project: { files: masmRoot, entrypoint: ".", name: "counter-account" },
    });
  });

  it("opens a project at an entrypoint", () => {
    expect(openProject(masmProject, "increment-note")).toEqual({
      project: { files: masmProject, entrypoint: "increment-note", name: "increment-note" },
    });
  });

  it.each([
    [masmRoot, undefined, "."],
    [masmRoot, "", "."],
    [masmRoot, ".", "."],
    [masmRoot, "./", "."],
    [masmProject, "./increment-note", "increment-note"],
    [masmProject, "increment-note/", "increment-note"],
    [masmProject, "././increment-note//", "increment-note"],
  ])("normalizes the entrypoint %j to %j", (files, entrypoint, normalized) => {
    const result = openProject(files, entrypoint);
    expect(result).toHaveProperty("project.entrypoint", normalized);
  });

  it.each([
    [42],
    [null],
    ["/increment-note"],
    ["../increment-note"],
    ["increment-note/../increment-note"],
    ["./../x"],
    ["a//b"],
    ["a\\b"],
  ])("refuses the entrypoint %j", (entrypoint) => {
    expect(openProject(masmProject, entrypoint)).toEqual({
      error: "invalid entrypoint",
    });
  });

  it("refuses a body with no files map", () => {
    for (const files of [undefined, null, "files", 1, ["miden-project.toml"]]) {
      expect(openProject(files)).toEqual({ error: "missing files" });
    }
  });

  it("refuses a file path that could leave the project", () => {
    for (const path of [
      "../miden-project.toml",
      "src/../../lib.masm",
      "/etc/passwd",
      "./src/lib.masm",
      "src//lib.masm",
      "src/",
      "",
      "src\\lib.masm",
    ]) {
      expect(openProject({ ...masmRoot, [path]: "" })).toEqual({
        error: `invalid file path: ${path}`,
      });
    }
  });

  it("refuses a file path that can't be written", () => {
    for (const path of ["src/a\u0000.masm", "src/a\n.masm", `src/${"a".repeat(256)}.masm`]) {
      expect(openProject({ ...masmRoot, [path]: "" })).toEqual({
        error: `invalid file path: ${path}`,
      });
    }
    expect(openProject({ ...masmRoot, src: "", "src/lib.masm": "" })).toEqual({
      error: "invalid file path: src",
    });
    const multiByte = `src/${"é".repeat(128)}`;
    expect(openProject({ ...masmRoot, [multiByte]: "" })).toEqual({
      error: `invalid file path: ${multiByte}`,
    });
    // The clash key comes first in key order, so it wins over the bad content.
    expect(openProject({ ...masmRoot, src: "", "src/other.masm": 1 })).toEqual({
      error: "invalid file path: src",
    });
    expect(openProject({ ...masmRoot, [`src/${"a".repeat(255)}`]: "" })).toHaveProperty("project");
  });

  it("refuses a file whose content isn't text", () => {
    expect(openProject({ ...masmRoot, "counter_account.masm": 1 })).toEqual({
      error: "invalid file content: counter_account.masm",
    });
  });

  it("checks the files before the entrypoint", () => {
    expect(openProject({ "../x": "" }, 42)).toEqual({
      error: "invalid file path: ../x",
    });
  });

  it("refuses a Rust project: a Cargo.toml at the entrypoint", () => {
    expect(openProject({ ...masmRoot, "Cargo.toml": "" })).toEqual({
      error: RUST_PROJECT_ERROR,
    });
    expect(
      openProject({ ...masmProject, "increment-note/Cargo.toml": "" }, "increment-note"),
    ).toEqual({ error: RUST_PROJECT_ERROR });
    expect(RUST_PROJECT_ERROR).toBe(
      "Rust projects are no longer supported: Miden projects are written in MASM (`miden-project.toml`)",
    );
  });

  it("takes a Cargo.toml elsewhere than the entrypoint as any other file", () => {
    const files = { ...masmProject, "Cargo.lock": "", "Cargo.toml": "" };
    expect(openProject(files, "increment-note")).toHaveProperty("project.name", "increment-note");
  });

  it("wants a miden-project.toml at the entrypoint", () => {
    expect(openProject({ "src/lib.masm": "" })).toEqual({
      error: "missing miden-project.toml",
    });
    expect(openProject(masmProject)).toEqual({
      error: "missing miden-project.toml",
    });
    expect(openProject(masmRoot, "sub")).toEqual({
      error: "missing miden-project.toml",
    });
  });

  it("refuses a miden-project.toml that isn't TOML", () => {
    expect(
      openProject(
        { ...masmProject, "increment-note/miden-project.toml": "not = [toml" },
        "increment-note",
      ),
    ).toEqual({ error: "increment-note/miden-project.toml is not valid TOML" });
  });

  it("refuses a workspace root as the entrypoint, naming the file", () => {
    expect(openProject({ "miden-project.toml": '[workspace]\nmembers = ["a"]\n' })).toEqual({
      error: "miden-project.toml has no [package]",
    });
  });

  it("treats a [package] without a string name as no package", () => {
    expect(
      openProject({
        ...masmRoot,
        "miden-project.toml": "[package]\nname.workspace = true\n",
      }),
    ).toEqual({ error: "miden-project.toml has no [package]" });
  });
});

describe("cargoPackageName", () => {
  it("reads the [package] name", () => {
    expect(cargoPackageName(cargoToml("counter-contract"))).toBe("counter-contract");
  });

  it("is undefined for a workspace root or a file that doesn't parse", () => {
    expect(cargoPackageName("[workspace]\nmembers = []\n")).toBeUndefined();
    expect(cargoPackageName("not = [toml")).toBeUndefined();
  });
});

describe("midenProjectLibrary", () => {
  it("reads the [package] name and the [lib] path", () => {
    expect(
      midenProjectLibrary(
        '[package]\nname = "counter-account"\n\n[lib]\nkind = "account-component"\npath = "./src/counter_account.masm"\n',
      ),
    ).toEqual({
      name: "counter-account",
      libPath: "src/counter_account.masm",
    });
  });

  it("has no lib path without a [lib] path", () => {
    expect(midenProjectLibrary('[package]\nname = "note"\n')).toEqual({
      name: "note",
      libPath: undefined,
    });
  });

  it("is undefined without a [package] or for a file that doesn't parse", () => {
    expect(midenProjectLibrary('[lib]\npath = "a.masm"\n')).toBeUndefined();
    expect(midenProjectLibrary("not = [toml")).toBeUndefined();
  });
});

describe("storedProjectKind", () => {
  it("is rust with a Cargo.toml at the entrypoint", () => {
    const files = {
      "counter-note/Cargo.toml": "",
      "counter-note/miden-project.toml": "",
    };
    expect(storedProjectKind(files, "counter-note")).toBe("rust");
  });

  it("is masm with no Cargo.toml at the entrypoint", () => {
    const files = {
      "Cargo.toml": "",
      "counter-note/miden-project.toml": "",
    };
    expect(storedProjectKind(files, "counter-note")).toBe("masm");
    expect(storedProjectKind({ "miden-project.toml": "" }, ".")).toBe("masm");
  });

  it("is rust for a project stored without its entrypoint", () => {
    expect(storedProjectKind({ "miden-project.toml": "" }, null)).toBe("rust");
  });
});
