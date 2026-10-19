import { describe, expect, it } from "vitest";
import { inferEntrypoint } from "../src/lib/infer-entrypoint.js";

const cargoToml = (name: string) => `[package]\nname = "${name}"\n`;

describe("inferEntrypoint", () => {
  it("finds a project at the root", () => {
    const files = {
      "Cargo.toml": cargoToml("counter-contract"),
      "miden-project.toml": "",
      "src/lib.rs": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBe(".");
  });

  it("finds a project in a subdirectory of a workspace", () => {
    const files = {
      "Cargo.toml":
        '[workspace]\nmembers = ["counter-contract", "counter-note"]\n',
      "counter-contract/Cargo.toml": cargoToml("counter-contract"),
      "counter-contract/miden-project.toml": "",
      "counter-note/Cargo.toml": cargoToml("counter-note"),
      "counter-note/miden-project.toml": "",
    };
    expect(inferEntrypoint(files, "counter-contract")).toBe("counter-contract");
  });

  it("ignores a crate with that name but no miden-project.toml", () => {
    const files = {
      "a/Cargo.toml": cargoToml("counter-contract"),
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
