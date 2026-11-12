import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBuildOutput, readBuildOutput } from "../src/lib/build-output.ts";

// The owner check needs the container's users; `undefined` skips it on the
// host, except in the case that tests it.
const NO_OWNER = undefined;

describe("checkBuildOutput", () => {
  let root: string;
  let other: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "build-output-"));
    other = await mkdtemp(join(tmpdir(), "build-output-other-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });

  it("passes a plain file under the root, and reads it", async () => {
    const path = join(root, "out.masp");
    await writeFile(path, "package");
    await expect(
      checkBuildOutput(path, root, NO_OWNER),
    ).resolves.toBeUndefined();
    // readBuildOutput checks against BUILD_USER, unset on the host.
    await expect(readBuildOutput(path, root)).resolves.toBe("package");
  });

  it("rejects a symlink to a file outside the root", async () => {
    const target = join(other, "secret");
    await writeFile(target, "secret");
    const path = join(root, "out.masp");
    await symlink(target, path);
    await expect(checkBuildOutput(path, root, NO_OWNER)).rejects.toThrow(
      "build output is not a plain file",
    );
  });

  it("rejects a symlink to a file inside the root", async () => {
    const target = join(root, "real.masp");
    await writeFile(target, "package");
    const path = join(root, "out.masp");
    await symlink(target, path);
    await expect(checkBuildOutput(path, root, NO_OWNER)).rejects.toThrow(
      "build output is not a plain file",
    );
  });

  it("rejects a file with a second hard link", async () => {
    const path = join(root, "out.masp");
    await writeFile(path, "package");
    await link(path, join(root, "copy.masp"));
    await expect(checkBuildOutput(path, root, NO_OWNER)).rejects.toThrow(
      "build output is not a plain file",
    );
  });

  it("rejects a file reached through a symlinked directory", async () => {
    await writeFile(join(other, "file"), "secret");
    await symlink(other, join(root, "dir"));
    await expect(
      checkBuildOutput(join(root, "dir", "file"), root, NO_OWNER),
    ).rejects.toThrow("build output is not a plain file");
  });

  it("rejects a path outside the root", async () => {
    const path = join(root, "..", `${root.split("/").at(-1)}-x`);
    await writeFile(path, "x");
    try {
      await expect(checkBuildOutput(path, root, NO_OWNER)).rejects.toThrow(
        "build output is not a plain file",
      );
    } finally {
      await rm(path, { force: true });
    }
  });

  it("rejects a file another user owns", async () => {
    const path = join(root, "out.masp");
    await writeFile(path, "package");
    const uid = process.getuid?.() ?? 0;
    await expect(
      checkBuildOutput(path, root, { uid: uid + 1, gid: 0 }),
    ).rejects.toThrow("build output is not a plain file");
    await expect(
      checkBuildOutput(path, root, { uid, gid: process.getgid?.() ?? 0 }),
    ).resolves.toBeUndefined();
  });

  it("doesn't name the path in its error", async () => {
    await mkdir(join(root, "release"));
    const path = join(root, "release", "out.masp");
    const error = await checkBuildOutput(path, root, NO_OWNER).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(root);
    expect((error as Error).message).not.toContain("out.masp");
  });
});
