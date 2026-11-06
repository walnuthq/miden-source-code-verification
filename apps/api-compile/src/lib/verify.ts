import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "miden-source-code-verification-utils/http-errors";
import { MIDEN_TOOL_REJECTED_EXIT_CODE } from "./constants.ts";
import { midenVerifier } from "./miden-verifier.ts";

// A failed `miden-verifier` run, with the status `/verify` answers it with: 400
// when the request can never verify (the resource isn't on-chain, the ID or the
// package is invalid), 502 when a retry may pass (the node, the store, a
// timeout).
export class VerifierError extends HttpError {
  constructor(message: string, status: 400 | 502) {
    super(status, message);
  }
}

export const writeResourceFile = async (resource: string) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "miden-resource-"));
  const resourcePath = join(tmpDir, "resource.txt");
  await writeFile(resourcePath, resource);
  return resourcePath;
};

// `code` is the resource's root: the account code root, or the note script
// root. The same root `miden-import` reads.
type MidenVerifierOutput =
  | { type: "account"; code: string; components: string[] }
  | { type: "note"; code: string; script: string };

// Whether the package at `maspPath` is the resource's on chain, with the
// resource's root as the verifier read it.
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
  // The tool prints its result whenever it exits 0, so nothing on stdout is a
  // broken run, not a resource that didn't verify.
  if (!result.stdout) {
    throw new VerifierError("miden-verifier printed no result", 502);
  }
  const output = JSON.parse(result.stdout) as MidenVerifierOutput;
  const target = `Custom(${commitment})`;
  const verified =
    output.type === "account"
      ? output.components.includes(target)
      : output.script === target;
  return { verified, root: output.code };
};
