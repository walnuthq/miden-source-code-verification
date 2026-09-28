import { MIDEN_TOOL_TIMEOUT_MS } from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

export const midenPackageMetadata = async (maspPath: string) => {
  try {
    console.info(`miden-package-metadata ${maspPath}`);
    const { stdout, stderr } = await execFile(
      "miden-package-metadata",
      [maspPath],
      { timeout: MIDEN_TOOL_TIMEOUT_MS },
    );
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "miden-package-metadata failed";
    return { error: message };
  }
};
