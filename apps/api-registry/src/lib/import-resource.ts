import { fetchApiCompile } from "@/lib/api-compile.js";
import type { StandardAccountComponent } from "@/lib/types.js";

// An account also comes back with its standard components and every procedure
// root in its code, which the id-keyed account lookup forwards as is.
type ImportedResource =
  | {
      type: "account";
      code: string;
      standardAccountComponents: StandardAccountComponent[];
      procedures: string[];
    }
  | { type: "note"; code: string };

/**
 * Fetches the on-chain code of a resource (account code root or note script
 * root) from the api-compile `/:networkId/import/:resourceId` endpoint. The
 * returned `code` is what the registry matches records against. Throws an
 * `ApiCompileError` with status 404 when the resource does not exist.
 */
export const importResource = async ({
  networkId,
  resourceId,
}: {
  networkId: string;
  resourceId: string;
}) => fetchApiCompile<ImportedResource>(`/${networkId}/import/${resourceId}`);
