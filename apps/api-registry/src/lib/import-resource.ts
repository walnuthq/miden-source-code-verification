import { API_COMPILE_URL } from "@/lib/constants.js";

/**
 * Fetches the on-chain code of a resource (account code root or note script
 * root) from the api-compile `/:networkId/import/:resourceId` endpoint. The
 * returned `code` is what the registry matches records against.
 */
export const importResource = async ({
  networkId,
  resourceId,
}: {
  networkId: string;
  resourceId: string;
}) => {
  const response = await fetch(
    `${API_COMPILE_URL}/${networkId}/import/${resourceId}`,
  );
  const data = await response.json();
  if (!response.ok) {
    const { error } = data as { error: string };
    throw new Error(error);
  }
  return data as { type: "account" | "note"; code: string };
};
