import { MIDEN_CLIENT_CACHE_DIR } from "@/lib/constants.js";
import { execFile } from "@/lib/utils.js";

export const midenImport = async ({
  networkId,
  resourceId,
}: {
  networkId: string;
  resourceId: string;
}) => {
  try {
    const args = ["--network-id", networkId, "--resource-id", resourceId];
    console.info(
      `miden-import --network-id ${networkId} --resource-id ${resourceId}`,
    );
    const { stdout } = await execFile("miden-import", args, {
      cwd: MIDEN_CLIENT_CACHE_DIR,
    });
    return { stdout };
  } catch (error) {
    // On a non-zero exit `miden-import` writes the reason to stderr; surface
    // that when available, otherwise fall back to the raw error message.
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : "";
    // `anyhow` prefixes the message with "Error: " on stderr; drop it.
    const message = (
      stderr || (error instanceof Error ? error.message : "miden-import failed")
    ).replace(/^Error:\s*/, "");
    return { error: message };
  }
};
