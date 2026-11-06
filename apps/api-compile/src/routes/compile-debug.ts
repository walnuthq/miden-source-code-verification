import { Router } from "express";
import type { CompileDebugResponse } from "miden-source-code-verification-utils/api-compile";
import { openProject } from "miden-source-code-verification-utils/project";
import { queueCompile } from "../lib/compile.ts";
import { abortOnClose } from "../lib/utils.ts";

const router = Router();

type CompileDebugRequestBody = {
  files?: unknown;
  entrypoint?: unknown;
  expectedCommitment?: string;
};

// Builds the debug variant of a package the registry already stores, for the
// backfill. The release build is rebuilt first and must still have the stored
// commitment: otherwise the toolchain has drifted, and a debug build made with
// it wouldn't be one of the stored package.
router.post("/compile-debug", async (req, res) => {
  const { files, entrypoint, expectedCommitment } =
    req.body as CompileDebugRequestBody;
  const opened = openProject(files, entrypoint);
  if ("error" in opened) {
    res.status(400).json({ error: opened.error });
    return;
  }
  if (typeof expectedCommitment !== "string" || !expectedCommitment) {
    res.status(400).json({ error: "missing expectedCommitment" });
    return;
  }
  const build = await queueCompile(
    {
      project: opened.project,
      debug: true,
      expectedCommitment,
      signal: abortOnClose(res),
    },
    (build) => build,
  );
  if (!build.built) {
    res.status(400).json({ error: build.stderr });
    return;
  }
  if (build.drift) {
    res
      .status(409)
      .json({ error: "toolchain no longer reproduces this package" });
    return;
  }
  res.json({
    // Requested, and the build didn't drift, so one was built.
    debug: build.debug ?? { error: "no debug build" },
  } satisfies CompileDebugResponse);
});

export default router;
