import {
  MIDEN_CLIENT_CACHE_DIR,
  MIDEN_TOOL_TIMEOUT_MS,
} from "@/lib/constants.js";
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
    console.info(
      `miden-verifier --network-id ${networkId} --resource-id ${resourceId} --masp-path ${maspPath}`,
    );
    const { stdout } = await execFile("miden-verifier", args, {
      cwd: MIDEN_CLIENT_CACHE_DIR,
      timeout: MIDEN_TOOL_TIMEOUT_MS,
    });
    return { stdout };
  } catch (error) {
    // On a non-zero exit `miden-verifier` writes the reason to stderr; surface
    // that when available, otherwise fall back to the raw error message.
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : "";
    // `anyhow` prefixes the message with "Error: " on stderr; drop it.
    const message = (
      stderr ||
      (error instanceof Error ? error.message : "miden-verifier failed")
    ).replace(/^Error:\s*/, "");
    return { error: message };
  }
};
