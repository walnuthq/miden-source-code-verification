import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIDEN_TOOL_REJECTED_EXIT_CODE } from "@/lib/constants.js";
import { midenVerifier } from "@/lib/miden-verifier.js";

// A failed `miden-verifier` run, with the status `/verify` answers it with: 400
// when the request can never verify (the resource isn't on-chain, the ID or the
// package is invalid), 502 when a retry may pass (the node, the store, a
// timeout).
export class VerifierError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 502,
  ) {
    super(message);
  }
}

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
  commitment,
}: {
  networkId: string;
  resourceId: string;
  resourcePath?: string;
  maspPath: string;
  commitment: string;
}) => {
  const result = await midenVerifier({
    networkId,
    resourceId,
    maspPath,
    resourcePath,
  });
  if (result.error !== undefined) {
    throw new VerifierError(
      result.error,
      result.exitCode === MIDEN_TOOL_REJECTED_EXIT_CODE ? 400 : 502,
    );
  }
  if (!result.stdout) {
    return false;
  }
  const output = JSON.parse(result.stdout) as MidenVerifierOutput;
  const target = `Custom(${commitment})`;
  if (output.type === "account") {
    return output.components.includes(target);
  }
  return output.script === target;
};
