import { describe, expect, it } from "vitest";

import { type Manifest, procedureExportPaths } from "../src/manifest.js";

const procedure = (path: string) => ({
  Procedure: {
    path,
    node: 0,
    source_node: null,
    digest: "0x00",
    signature: null,
    attributes: { attrs: [] },
  },
});

describe("procedureExportPaths", () => {
  it("lists the paths of exported procedures only", () => {
    const manifest = {
      exports: [
        procedure("miden:counter/counter@0.1.0#get-count"),
        { Constant: { path: "miden:counter/counter@0.1.0#KEY", value: 1 } },
        procedure("miden:counter/counter@0.1.0#increment-count"),
      ],
      dependencies: [],
    } as unknown as Manifest;
    expect(procedureExportPaths(manifest)).toEqual([
      "miden:counter/counter@0.1.0#get-count",
      "miden:counter/counter@0.1.0#increment-count",
    ]);
  });

  it("is empty for a manifest with no exports", () => {
    expect(procedureExportPaths({ exports: [], dependencies: [] })).toEqual([]);
  });
});
