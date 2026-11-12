import { chown, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import { API_USER, WORK_DIR } from "./constants.ts";
import { midenVerifier } from "./helper-tools.ts";

// A failed `miden-verifier` run, with the status `/verify` answers it with: 400
// when the request can never verify (the resource isn't on-chain, the ID or the
// package is invalid), 502 when a retry may pass (the node, the store, a
// timeout, a run that printed no result).
export class VerifierError extends HttpError {
  constructor(message: string, status: 400 | 502) {
    super(status, message);
  }
}

export const writeResourceFile = async (resource: string) => {
  await mkdir(join(WORK_DIR, "resources"), { recursive: true });
  const tmpDir = await mkdtemp(join(WORK_DIR, "resources", "miden-resource-"));
  const resourcePath = join(tmpDir, "resource.txt");
  try {
    await writeFile(resourcePath, resource);
    // The verifier reads it as another user than the server.
    if (API_USER) {
      await chown(tmpDir, API_USER.uid, API_USER.gid);
      await chown(resourcePath, API_USER.uid, API_USER.gid);
    }
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
  return resourcePath;
};

// Whether the package at `maspPath` is the resource's on chain, with the
// resource's root as the verifier read it: the account code root or the note
// script root, the same root `miden-import` reads.
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
  const run = await midenVerifier({
    networkId,
    resourceId,
    maspPath,
    resourcePath,
  });
  if ("error" in run) {
    throw new VerifierError(run.error, run.rejected ? 400 : 502);
  }
  const { output } = run;
  const target = `Custom(${commitment})`;
  const verified =
    output.type === "account"
      ? output.components.includes(target)
      : output.script === target;
  return { verified, root: output.code };
};
