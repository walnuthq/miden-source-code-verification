import { Router } from "express";
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
  const { stderr, commitment, drift, debug } = await queueCompile(
    {
      project: opened.project,
      debug: true,
      expectedCommitment,
      signal: abortOnClose(res),
    },
    (compiled) => compiled,
  );
  if (!commitment) {
    res.status(400).json({ error: stderr });
    return;
  }
  if (drift) {
    res
      .status(409)
      .json({ error: "toolchain no longer reproduces this package" });
    return;
  }
  res.json({ debug });
});

export default router;
