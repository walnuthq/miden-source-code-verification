import type { MaspVariant } from "miden-source-code-verification-utils/api-registry";
import { storedProjectKind } from "miden-source-code-verification-utils/project";

import type { packagesTable } from "../db/schema.ts";

type PackageRow = Pick<
  typeof packagesTable.$inferSelect,
  "commitment" | "files" | "entrypoint" | "debugCommitment"
>;

/**
 * The debug build the registry serves for a package as its `.debug.masp`: its
 * commitment, and the variant of the package's artifact that holds it. A Rust
 * package has one only when it was verified before debug builds were retired
 * (`<commitment>.debug.masp` in the store). A MASM package is one package with
 * debug info, so its release artifact is its debug build too, under the same
 * commitment. Null when there is none.
 */
export const debugBuildOf = (
  row: PackageRow,
): { commitment: string; variant: MaspVariant } | null => {
  if (row.debugCommitment) {
    return { commitment: row.debugCommitment, variant: "debug" };
  }
  return storedProjectKind(row.files, row.entrypoint) === "masm"
    ? { commitment: row.commitment, variant: "release" }
    : null;
};
