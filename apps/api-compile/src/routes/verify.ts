import { dirname } from "node:path";
import { Router } from "express";
import type { VerifyResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";
import { queueCompile } from "../lib/compile.ts";
import { abortOnClose, removeDirs } from "../lib/utils.ts";
import { verify, writeResourceFile } from "../lib/verify.ts";

const router = Router();

type VerifyRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  networkId?: unknown;
  resourceId?: unknown;
  resource?: unknown;
  debug?: boolean;
};

router.post("/verify", async (req, res) => {
  const { files, entrypoint, networkId, resourceId, resource, debug } =
    req.body as VerifyRequestBody;
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
  // Verifying reads the built package from disk, so it runs before the
  // build's files are deleted. A failed run throws a `VerifierError`, answered
  // with its status.
  const result = await queueCompile(
    // The debug variant is built whether or not the release build verifies,
    // in the same queue slot: verifying runs after the slot is released.
    {
      project: opened.project,
      debug: debug === true,
      signal: abortOnClose(res),
    },
    async (build) => {
      // Without a package there is nothing to check: the failed build's
      // diagnostics are the error.
      if (!build.built) {
        return { error: build.stderr };
      }
      const {
        maspPath,
        masp,
        commitment,
        kind,
        manifest,
        readOnly,
        files: compiledFiles,
        cargoMidenVersion,
        debug: debugBuild,
      } = build;
      const resourcePath = resource
        ? await writeResourceFile(resource)
        : undefined;
      try {
        const { verified, root } = await verify({
          networkId,
          resourceId,
          resourcePath,
          maspPath,
          commitment,
        });
        return {
          verified,
          root,
          masp,
          commitment,
          kind,
          manifest,
          readOnly,
          files: compiledFiles,
          cargoMidenVersion,
          debug: debugBuild,
        } satisfies VerifyResponse;
      } finally {
        if (resourcePath) {
          await removeDirs([dirname(resourcePath)]);
        }
      }
    },
  );
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

export default router;
