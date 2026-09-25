import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { zipSources } from "@/lib/sources-archive";

describe("zipSources", () => {
  it("puts every file, hidden ones included, under the package's folder", () => {
    const files = {
      ".cargo/config.toml": "[build]\n",
      "Cargo.toml": '[package]\nname = "counter-contract"\n',
      "rust-toolchain.toml": "[toolchain]\n",
      "src/lib.rs": "#![no_std]\n",
    };
    const entries = unzipSync(zipSources("counter-contract", files));
    expect(
      Object.fromEntries(
        Object.entries(entries).map(([path, content]) => [
          path,
          strFromU8(content),
        ]),
      ),
    ).toEqual({
      "counter-contract/.cargo/config.toml": "[build]\n",
      "counter-contract/Cargo.toml": '[package]\nname = "counter-contract"\n',
      "counter-contract/rust-toolchain.toml": "[toolchain]\n",
      "counter-contract/src/lib.rs": "#![no_std]\n",
    });
  });
});
