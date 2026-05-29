import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import lodash from "lodash";
import { CARGO_TARGET_DIR } from "@/lib/constants.js";
import { cargoMidenBuild } from "@/lib/cargo-miden.js";
import { midenPackageMetadata } from "@/lib/miden-package-metadata.js";
import type { Manifest } from "@/lib/types.js";

const { snakeCase } = lodash;

export const compile = async ({
  files,
  entrypoint,
}: {
  files: Record<string, string>;
  entrypoint?: string;
}) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-project-")); // Write project files
  const outputName = snakeCase(tmpDir.split("/").at(-1) ?? "");
  const cargoTomlPath = entrypoint ? `${entrypoint}/Cargo.toml` : "Cargo.toml";
  const cargoToml = files[cargoTomlPath] ?? "";
  files[cargoTomlPath] = cargoToml.replace(
    "[lib]",
    `[lib]\nname = "${outputName}"`,
  );
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
  } = await cargoMidenBuild(entrypoint ? `${tmpDir}/${entrypoint}` : tmpDir);
  if (cargoMidenError) {
    return {
      stdout,
      stderr: cargoMidenError,
    };
  }
  const maspPath = `${CARGO_TARGET_DIR}/miden/release/${outputName}.masp`;
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
