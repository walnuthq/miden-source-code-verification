import { dirname } from "node:path";

import { Router } from "express";
import type { VerifyResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";

import { type Assembly, queueAssemble } from "../lib/assemble.ts";
import { abortOnClose, removeDirs } from "../lib/utils.ts";
import { verify, writeResourceFile } from "../lib/verify.ts";

const router = Router();

// Verifies the assembly's package, in its slot, while the package is on disk.
// A failed run throws a `VerifierError`, answered with its status.
const verifyAssembly = async ({
  assembly,
  networkId,
  resourceId,
  resource,
  signal,
}: {
  assembly: Assembly;
  networkId: string;
  resourceId: string;
  resource: string | undefined;
  signal: AbortSignal;
}): Promise<VerifyResponse | { error: string }> => {
  // Without a package there is nothing to check: the failed build's
  // diagnostics are the error.
  if (!assembly.built) {
    return { error: assembly.stderr };
  }
  // The package as the answer carries it: no path on disk, and no build
  // output, which a verification doesn't answer.
  const { maspPath, built: _built, stdout: _stdout, stderr: _stderr, ...answer } = assembly;
  const resourcePath = resource ? await writeResourceFile(resource) : undefined;
  try {
    const { verified, root } = await verify({
      networkId,
      resourceId,
      resourcePath,
      maspPath,
      commitment: answer.commitment,
      signal,
    });
    return { verified, root, ...answer };
  } finally {
    if (resourcePath) {
      await removeDirs([dirname(resourcePath)]);
    }
  }
};

type VerifyRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  networkId?: unknown;
  resourceId?: unknown;
  resource?: unknown;
};

router.post("/verify", async (req, res) => {
  const { files, entrypoint, networkId, resourceId, resource } = req.body as VerifyRequestBody;
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  if (typeof networkId !== "string" || !networkId) {
    res.status(400).json({ error: "missing networkId" });
    return;
  }
  if (typeof resourceId !== "string" || !resourceId) {
    res.status(400).json({ error: "missing resourceId" });
    return;
  }
  if (resource !== undefined && typeof resource !== "string") {
    res.status(400).json({ error: "invalid resource" });
    return;
  }
  const result = await queueAssemble(
    { project: opened.project, signal: abortOnClose(res) },
    (assembly, signal) =>
      verifyAssembly({
        assembly,
        networkId,
        resourceId,
        resource,
        signal,
      }),
  );
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

export default router;
