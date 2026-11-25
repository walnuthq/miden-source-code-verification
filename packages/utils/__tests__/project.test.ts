import { describe, expect, it } from "vitest";
import {
  cargoPackageName,
  inferEntrypoint,
  openProject,
  storedProjectKind,
} from "../src/project.ts";

const cargoToml = (name: string) => `[package]\nname = "${name}"\n`;

const rootProject = {
  "Cargo.toml": cargoToml("counter-contract"),
  "miden-project.toml": "",
  "src/lib.rs": "",
};

const workspace = {
  "Cargo.toml": '[workspace]\nmembers = ["counter-contract", "counter-note"]\n',
  "counter-contract/Cargo.toml": cargoToml("counter-contract"),
  "counter-contract/miden-project.toml": "",
  "counter-contract/src/lib.rs": "",
  "counter-note/Cargo.toml": cargoToml("counter-note"),
  "counter-note/miden-project.toml": "",
  "counter-note/src/lib.rs": "",
};

describe("openProject", () => {
  it("opens a project at the root", () => {
    expect(openProject(rootProject)).toEqual({
      project: {
        files: rootProject,
        entrypoint: ".",
        name: "counter-contract",
        kind: "rust",
      },
    });
  });

  it("opens a project at an entrypoint", () => {
    expect(openProject(workspace, "counter-note")).toEqual({
      project: {
        files: workspace,
        entrypoint: "counter-note",
        name: "counter-note",
        kind: "rust",
      },
    });
  });

  it.each([
    [rootProject, undefined, "."],
    [rootProject, "", "."],
    [rootProject, ".", "."],
    [rootProject, "./", "."],
    [workspace, "./counter-note", "counter-note"],
    [workspace, "counter-note/", "counter-note"],
    [workspace, "././counter-note//", "counter-note"],
  ])("normalizes the entrypoint %j to %j", (files, entrypoint, normalized) => {
    const result = openProject(files, entrypoint);
    expect(result).toHaveProperty("project.entrypoint", normalized);
  });

  it.each([
    [42],
    [null],
    ["/counter-note"],
    ["../counter-note"],
    ["counter-note/../counter-note"],
    ["./../x"],
    ["a//b"],
    ["a\\b"],
  ])("refuses the entrypoint %j", (entrypoint) => {
    expect(openProject(workspace, entrypoint)).toEqual({
      error: "invalid entrypoint",
    });
  });

  it("refuses a body with no files map", () => {
    for (const files of [undefined, null, "files", 1, ["Cargo.toml"]]) {
      expect(openProject(files)).toEqual({ error: "missing files" });
    }
  });

  it("refuses a file path that could leave the project", () => {
    for (const path of [
      "../Cargo.toml",
      "src/../../lib.rs",
      "/etc/passwd",
      "./src/lib.rs",
      "src//lib.rs",
      "src/",
      "",
      "src\\lib.rs",
    ]) {
      expect(openProject({ ...rootProject, [path]: "" })).toEqual({
        error: `invalid file path: ${path}`,
      });
    }
  });

  it("refuses a file path that can't be written", () => {
    for (const path of [
      "src/a\u0000.rs",
      "src/a\n.rs",
      `src/${"a".repeat(256)}.rs`,
    ]) {
      expect(openProject({ ...rootProject, [path]: "" })).toEqual({
        error: `invalid file path: ${path}`,
      });
    }
    expect(openProject({ ...rootProject, src: "", "src/lib.rs": "" })).toEqual({
      error: "invalid file path: src",
    });
    const multiByte = `src/${"é".repeat(128)}`;
    expect(openProject({ ...rootProject, [multiByte]: "" })).toEqual({
      error: `invalid file path: ${multiByte}`,
    });
    // The clash key comes first in key order, so it wins over the bad content.
    expect(openProject({ ...rootProject, src: "", "src/other.rs": 1 })).toEqual(
      { error: "invalid file path: src" },
    );
    expect(
      openProject({ ...rootProject, [`src/${"a".repeat(255)}`]: "" }),
    ).toHaveProperty("project");
  });

  it("refuses a file whose content isn't text", () => {
    expect(openProject({ ...rootProject, "src/lib.rs": 1 })).toEqual({
      error: "invalid file content: src/lib.rs",
    });
  });

  it("checks the files before the entrypoint", () => {
    expect(openProject({ "../x": "" }, 42)).toEqual({
      error: "invalid file path: ../x",
    });
  });

  it("wants a Cargo.toml at the entrypoint", () => {
    expect(openProject({ "src/lib.rs": "" })).toEqual({
      error: "missing Cargo.toml",
    });
    expect(openProject(rootProject, "sub")).toEqual({
      error: "missing Cargo.toml",
    });
  });

  it("wants a miden-project.toml next to it", () => {
    expect(
      openProject({ "Cargo.toml": cargoToml("x"), "src/lib.rs": "" }),
    ).toEqual({ error: "missing miden-project.toml" });
    expect(
      openProject(
        { ...workspace, "counter-note/miden-project.toml": undefined },
        "counter-note",
      ),
    ).toEqual({
      error: "invalid file content: counter-note/miden-project.toml",
    });
  });

  it("refuses a Cargo.toml that isn't TOML", () => {
    expect(
      openProject({ ...rootProject, "Cargo.toml": "not = [toml" }),
    ).toEqual({ error: "Cargo.toml is not valid TOML" });
  });

  it("refuses a workspace root as the entrypoint, naming the file", () => {
    expect(openProject({ ...workspace, "miden-project.toml": "" })).toEqual({
      error: "Cargo.toml has no [package]",
    });
    expect(
      openProject(
        { ...workspace, "counter-note/Cargo.toml": "[workspace]\n" },
        "counter-note",
      ),
    ).toEqual({ error: "counter-note/Cargo.toml has no [package]" });
  });

  it("treats a [package] without a string name as no package", () => {
    expect(
      openProject({
        ...rootProject,
        "Cargo.toml": "[package]\nname.workspace = true\n",
      }),
    ).toEqual({ error: "Cargo.toml has no [package]" });
  });
});

const midenProjectToml = (name: string) =>
  `[package]\nname = "${name}"\nversion = "0.1.0"\n`;

const masmProject = {
  "counter-account/miden-project.toml": midenProjectToml("counter-account"),
  "counter-account/counter_account.masm": "",
  "increment-note/miden-project.toml": midenProjectToml("increment-note"),
  "increment-note/increment_note.masm": "",
};

describe("openProject with masm", () => {
  const open = (files: unknown, entrypoint?: unknown) =>
    openProject(files, entrypoint, { masm: true });

  it("opens a MASM project, named by its miden-project.toml", () => {
    expect(open(masmProject, "increment-note")).toEqual({
      project: {
        files: masmProject,
        entrypoint: "increment-note",
        name: "increment-note",
        kind: "masm",
      },
    });
  });

  it("opens a Rust project as before", () => {
    expect(open(rootProject)).toEqual(openProject(rootProject));
    expect(open(workspace, "counter-note")).toEqual(
      openProject(workspace, "counter-note"),
    );
  });

  it("takes a Cargo.toml at the entrypoint, not elsewhere, for Rust", () => {
    const files = { ...masmProject, "Cargo.lock": "", "Cargo.toml": "" };
    expect(open(files, "increment-note")).toHaveProperty(
      "project.kind",
      "masm",
    );
  });

  it("wants a miden-project.toml at the entrypoint", () => {
    expect(open({ "src/lib.rs": "" })).toEqual({
      error: "missing miden-project.toml",
    });
    expect(open(masmProject)).toEqual({
      error: "missing miden-project.toml",
    });
  });

  it("refuses a miden-project.toml that isn't TOML", () => {
    expect(
      open(
        { ...masmProject, "increment-note/miden-project.toml": "not = [toml" },
        "increment-note",
      ),
    ).toEqual({ error: "increment-note/miden-project.toml is not valid TOML" });
  });

  it("refuses a miden-project.toml with no [package]", () => {
    expect(
      open({ "miden-project.toml": '[workspace]\nmembers = ["a"]\n' }),
    ).toEqual({ error: "miden-project.toml has no [package]" });
  });

  it("is off by default: a MASM project is missing its Cargo.toml", () => {
    expect(openProject(masmProject, "increment-note")).toEqual({
      error: "missing Cargo.toml",
    });
  });
});

describe("cargoPackageName", () => {
  it("reads the [package] name", () => {
    expect(cargoPackageName(cargoToml("counter-contract"))).toBe(
      "counter-contract",
    );
  });

  it("is undefined for a workspace root or a file that doesn't parse", () => {
    expect(cargoPackageName("[workspace]\nmembers = []\n")).toBeUndefined();
    expect(cargoPackageName("not = [toml")).toBeUndefined();
  });
});

describe("inferEntrypoint", () => {
  it("finds a project at the root", () => {
    expect(inferEntrypoint(rootProject, "counter-contract")).toBe(".");
  });

  it("finds a project in a subdirectory of a workspace", () => {
    expect(inferEntrypoint(workspace, "counter-contract")).toBe(
      "counter-contract",
    );
  });

  it("ignores a crate with that name but no miden-project.toml", () => {
    const files = {
      "a/Cargo.toml": cargoToml("counter-contract"),
      "b/Cargo.toml": cargoToml("counter-contract"),
      "b/miden-project.toml": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBe("b");
  });

  it("matches the name exactly, not up to - and _", () => {
    const files = {
      "a/Cargo.toml": cargoToml("counter_contract"),
      "a/miden-project.toml": "",
      "b/Cargo.toml": cargoToml("counter-contract"),
      "b/miden-project.toml": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBe("b");
  });

  it("is null when several projects match", () => {
    const files = {
      "a/Cargo.toml": cargoToml("counter-contract"),
      "a/miden-project.toml": "",
      "b/Cargo.toml": cargoToml("counter-contract"),
      "b/miden-project.toml": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBeNull();
  });

  it("is null when none matches, or a Cargo.toml doesn't parse", () => {
    const files = {
      "Cargo.toml": "not = [toml",
      "miden-project.toml": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBeNull();
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
