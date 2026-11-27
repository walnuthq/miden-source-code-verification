import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { zipSources } from "@/lib/sources-archive";

describe("zipSources", () => {
  it("puts every file, hidden ones included, under the package's folder", () => {
    const files = {
      ".gitignore": "target/\n",
      "miden-project.toml": '[package]\nname = "counter-contract"\n',
      "README.md": "# Counter\n",
      "asm/counter_contract.masm": "pub proc get_count()\nend\n",
    };
    const entries = unzipSync(zipSources("counter-contract", files));
    expect(
      Object.fromEntries(
        Object.entries(entries).map(([path, content]) => [path, strFromU8(content)]),
      ),
    ).toEqual({
      "counter-contract/.gitignore": "target/\n",
      "counter-contract/miden-project.toml": '[package]\nname = "counter-contract"\n',
      "counter-contract/README.md": "# Counter\n",
      "counter-contract/asm/counter_contract.masm": "pub proc get_count()\nend\n",
    });
  });
});
