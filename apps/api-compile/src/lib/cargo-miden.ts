import { CARGO_TARGET_DIR } from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

export const cargoMidenVersion = async () => {
  const { stdout } = await execFile("cargo", ["miden", "--version"]);
  const [, version = ""] = stdout.split(" ").map((part) => part.trim());
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${patch}`;
};

export const cargoMidenBuild = async ({
  projectDir,
  midencTargetDir,
}: {
  projectDir: string;
  midencTargetDir: string;
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
      },
    );
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "cargo-miden failed";
    return { error: message };
  }
};
