import { MIDEN_VERIFIER_CACHE_DIR } from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

export const midenVerifier = async ({
  networkId,
  resourceId,
  resourcePath,
  maspPath,
}: {
  networkId: string;
  resourceId: string;
  resourcePath?: string;
  maspPath: string;
}) => {
  try {
    const args = [
      "--network-id",
      networkId,
      "--resource-id",
      resourceId,
      "--masp-path",
      maspPath,
    ];
    if (resourcePath) {
      args.push("--resource-path", resourcePath);
    }
    const { stdout, stderr } = await execFile("miden-verifier", args, {
      cwd: MIDEN_VERIFIER_CACHE_DIR,
    });
    return { stdout, stderr };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "miden-verifier failed";
    return { error: message };
  }
};
