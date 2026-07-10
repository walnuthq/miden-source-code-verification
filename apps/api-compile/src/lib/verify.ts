import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { midenVerifier } from "@/lib/miden-verifier.js";

export const writeResourceFile = async (resource: string) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-resource-"));
  const resourcePath = join(tmpDir, "resource.txt");
  await writeFile(resourcePath, resource);
  return resourcePath;
};

type MidenVerifierOutput =
  | { type: "account"; code: string; components: string[] }
  | { type: "note"; code: string; script: string };

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
  if (!stdout) {
    return false;
  }
  const output = JSON.parse(stdout) as MidenVerifierOutput;
  const target = `Custom(${digest})`;
  if (output.type === "account") {
    return output.components.includes(target);
  }
  return output.script === target;
};
