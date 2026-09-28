import {
  CARGO_MIDEN_BUILD_TIMEOUT_MS,
  CARGO_TARGET_DIR,
  MIDEN_TOOL_TIMEOUT_MS,
} from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

export const cargoMidenVersion = async () => {
  const { stdout } = await execFile("cargo", ["miden", "--version"], {
    timeout: MIDEN_TOOL_TIMEOUT_MS,
  });
  const [, version = ""] = stdout.split(" ").map((part) => part.trim());
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${patch}`;
};

export const cargoMidenBuild = async ({
  projectDir,
  midencTargetDir,
  signal,
}: {
  projectDir: string;
  midencTargetDir: string;
  signal?: AbortSignal;
}) => {
  try {
    const { stdout, stderr } = await execFile(
      "cargo",
      ["miden", "build", "--release"],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          CARGO_TARGET_DIR,
          MIDENC_TARGET_DIR: midencTargetDir,
        },
        timeout: CARGO_MIDEN_BUILD_TIMEOUT_MS,
        signal,
      },
    );
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "cargo-miden failed";
    return { error: message };
  }
};
