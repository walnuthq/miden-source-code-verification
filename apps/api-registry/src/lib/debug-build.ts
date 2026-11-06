import { updatePackage } from "../db/packages.ts";
import type { MaspStore } from "../storage/masp-store.ts";
import type { DebugBuild } from "./api-compile.ts";

// Stores a package's debug build next to its release build, keyed by the
// release `commitment`, then records it on the row: artifact before row, as
// for the release build. Returns whether it stored one.
export const storeDebugBuild = async ({
  maspStore,
  packageId,
  commitment,
  debug,
}: {
  maspStore: MaspStore;
  packageId: string;
  commitment: string;
  debug: DebugBuild | undefined;
}) => {
  if (!debug) {
    return false;
  }
  if ("error" in debug) {
    console.error(`debug build of ${commitment} failed: ${debug.error}`);
    return false;
  }
  await maspStore.put(commitment, Buffer.from(debug.masp, "base64"), "debug");
  await updatePackage(packageId, {
    debugCommitment: debug.commitment,
    debugBuiltWith: debug.cargoMidenVersion ?? null,
  });
  return true;
};
