import { dirname } from "node:path";
import { Router } from "express";
import { openProject } from "miden-source-code-verification-utils/project";
import { queueCompile } from "../lib/compile.ts";
import { abortOnClose, removeDirs } from "../lib/utils.ts";
import { verify, writeResourceFile } from "../lib/verify.ts";

const router = Router();

type VerifyRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  networkId?: string;
  resourceId?: string;
  resource?: string;
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
  if (!networkId) {
    res.status(400).json({ error: "missing networkId" });
    return;
  }
  if (!resourceId) {
    res.status(400).json({ error: "missing resourceId" });
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
    async ({
      stderr,
      maspPath,
      masp,
      commitment,
      kind,
      manifest,
      readOnly,
      files: compiledFiles,
      cargoMidenVersion,
      debug: debugBuild,
    }) => {
      if (!maspPath) {
        return { error: stderr };
      }
      const resourcePath = resource
        ? await writeResourceFile(resource)
        : undefined;
      try {
        const verified = await verify({
          networkId,
          resourceId,
          resourcePath,
          maspPath,
          commitment,
        });
        return {
          verified,
          masp,
          commitment,
          kind,
          manifest,
          readOnly,
          files: compiledFiles,
          cargoMidenVersion,
          // Set when `debug` was requested. Its failure is `debug.error`,
          // which never changes `verified`.
          debug: debugBuild,
        };
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
