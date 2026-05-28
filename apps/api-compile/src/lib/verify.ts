import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { midenVerifier } from "@/lib/miden-verifier.js";

export const writeResourceFile = async (resource: string) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-resource-"));
  const resourcePath = join(tmpDir, "resource.txt");
  await writeFile(resourcePath, resource);
  return resourcePath;
};

export const verify = async ({
  networkId,
  resourceId,
  resourcePath,
  maspPath,
  digest,
}: {
  networkId: string;
  resourceId: string;
  resourcePath?: string;
  maspPath: string;
  digest: string;
}) => {
  const { stdout, error } = await midenVerifier({
    networkId,
    resourceId,
    maspPath,
    resourcePath,
  });
  if (error) {
    throw new Error(error);
  }
  return stdout?.includes(`Custom(${digest})`);
};
