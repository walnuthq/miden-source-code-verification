import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lodash from "lodash";
import { cargoMidenBuild } from "@/lib/cargo-miden.js";
import { CARGO_TARGET_DIR } from "@/lib/constants.js";
import { midenPackageMetadata } from "@/lib/miden-package-metadata.js";
import type { Manifest } from "@/lib/types.js";
import { parseCargoToml } from "miden-source-code-verification-utils";

const { snakeCase } = lodash;

export const compile = async ({
  files,
  entrypoint = ".",
}: {
  files: Record<string, string>;
  entrypoint?: string;
}) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-project-")); // Write project files
  const outputName = snakeCase(tmpDir.split("/").at(-1) ?? "");
  const midencTargetDir = `${CARGO_TARGET_DIR}/${outputName}`;
  const cargoTomlPath = join(entrypoint, "Cargo.toml");
  const cargoToml = files[cargoTomlPath] ?? "";
  const {
    package: { name: packageName },
  } = parseCargoToml(cargoToml);
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(tmpDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  const {
    stdout = "",
    stderr = "",
    error: cargoMidenError,
  } = await cargoMidenBuild({
    projectDir: entrypoint ? `${tmpDir}/${entrypoint}` : tmpDir,
    midencTargetDir,
  });
  if (cargoMidenError) {
    return {
      stdout,
      stderr: cargoMidenError,
    };
  }
  const maspPath = `${midencTargetDir}/release/${packageName}.masp`;
  const [
    maspBuffer,
    {
      stdout: midenPackageMetadataStdout = "",
      error: midenPackageMetadataError,
    },
  ] = await Promise.all([readFile(maspPath), midenPackageMetadata(maspPath)]);
  if (midenPackageMetadataError) {
    throw new Error(midenPackageMetadataError);
  }
  const { digest, manifest } = JSON.parse(midenPackageMetadataStdout) as {
    digest: string;
    manifest: Manifest;
  };
  return {
    stdout,
    stderr,
    maspPath,
    masp: maspBuffer.toString("base64"),
    digest,
    manifest,
  };
};
