import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { midenPackageMetadata } from "../src/lib/helper-tools.ts";
import { useFakeTool } from "./fake-tool.ts";

// A tool timeout short enough to trip.
vi.mock("../src/lib/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/constants.ts")>()),
  MIDEN_TOOL_TIMEOUT_MS: 1_000,
}));

// The rules every helper tool is run by, through `miden-package-metadata`,
// whose only argument is the path: the fake behaves as it says.
const FAKE_MIDEN_PACKAGE_METADATA = `#!/bin/sh
case "$1" in
  ok) echo '{"commitment":"0x01"}' ;;
  rejected) echo "Error: failed to read 'nope.masp'" >&2; exit 2 ;;
  failed) printf 'Error: rpc error\n\nCaused by:\n    request timed out\n' >&2; exit 1 ;;
  slow) sleep 5 ;;
  silent) exit 0 ;;
  blank) echo ;;
  garbled) echo "not json" ;;
esac
`;

describe("a helper tool", () => {
  useFakeTool("miden-package-metadata", FAKE_MIDEN_PACKAGE_METADATA);

  it("answers what it printed", async () => {
    await expect(midenPackageMetadata("ok")).resolves.toEqual({
      output: { commitment: "0x01" },
    });
  });

  it("is rejected when it exits with 2, with the reason it wrote", async () => {
    await expect(midenPackageMetadata("rejected")).resolves.toEqual({
      error: "failed to read 'nope.masp'",
      rejected: true,
    });
  });

  it("fails when it exits with 1, with the whole reason", async () => {
    await expect(midenPackageMetadata("failed")).resolves.toEqual({
      error: "rpc error\n\nCaused by:\n    request timed out",
      rejected: false,
    });
  });

  it("fails when it times out", async () => {
    await expect(midenPackageMetadata("slow")).resolves.toEqual({
      error: "miden-package-metadata timed out after 1s",
      rejected: false,
    });
  });

  it("fails when it prints nothing", async () => {
    await expect(midenPackageMetadata("silent")).resolves.toEqual({
      error: "miden-package-metadata printed no result",
      rejected: false,
    });
    await expect(midenPackageMetadata("blank")).resolves.toEqual({
      error: "miden-package-metadata printed no result",
      rejected: false,
    });
  });

  it("fails when it prints something that isn't JSON", async () => {
    await expect(midenPackageMetadata("garbled")).resolves.toEqual({
      error: "miden-package-metadata printed something that isn't JSON",
      rejected: false,
    });
  });
});

describe("a helper tool that isn't installed", () => {
  const path = process.env.PATH ?? "";
  let emptyDir = "";

  beforeAll(async () => {
    emptyDir = await mkdtemp(join(tmpdir(), "no-tools-"));
    process.env.PATH = emptyDir;
  });

  afterAll(async () => {
    process.env.PATH = path;
    await rm(emptyDir, { recursive: true, force: true });
  });

  it("fails as a spawn error", async () => {
    await expect(midenPackageMetadata("ok")).resolves.toEqual({
      error: "spawn miden-package-metadata ENOENT",
      rejected: false,
    });
  });
});
