import { join } from "node:path";
import { parseCargoToml } from "miden-source-code-verification-utils";
import type {
  Manifest,
  TargetType,
} from "miden-source-code-verification-utils/manifest";
import { getPackage, insertPackage } from "@/db/packages.js";
import {
  getVerifiedAccountComponent,
  insertVerifiedAccountComponent,
} from "@/db/verified-account-components.js";
import {
  getVerifiedAccountByCode,
  insertVerifiedAccountCode,
} from "@/db/verified-accounts.js";
import { fetchApiCompile } from "@/lib/api-compile.js";
import { type DebugBuild, storeDebugBuild } from "@/lib/debug-build.js";
import { importResource } from "@/lib/import-resource.js";
import type { MaspStore } from "@/storage/masp-store.js";

export const verifyAccountComponent = async ({
  networkId,
  accountId,
  files,
  entrypoint = ".",
  source = "unknown",
  maspStore,
}: {
  networkId: string;
  accountId: string;
  files: Record<string, string>;
  entrypoint?: string;
  source?: string;
  maspStore: MaspStore;
}) => {
  const cargoTomlPath = join(entrypoint, "Cargo.toml");
  const cargoToml = files[cargoTomlPath] ?? "";
  const {
    package: { name },
  } = parseCargoToml(cargoToml);
  const {
    verified,
    masp,
    commitment,
    kind,
    manifest,
    files: compiledFiles,
    cargoMidenVersion,
    debug,
  } = await fetchApiCompile<{
    verified: boolean;
    masp: string;
    commitment: string;
    // The compiled package's own kind, stored as the package's type.
    kind: TargetType;
    manifest: Manifest;
    // The sources plus the lockfile the build used. Absent from api-compile
    // versions that predate it.
    files?: Record<string, string>;
    // Absent from api-compile versions that predate them.
    cargoMidenVersion?: string;
    debug?: DebugBuild;
  }>("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      networkId,
      resourceId: accountId,
      entrypoint,
      debug: true,
    }),
  });
  if (verified) {
    const { code } = await importResource({
      networkId,
      resourceId: accountId,
    });
    const verifiedAccount = await getVerifiedAccountByCode({ networkId, code });
    const verifiedAccountId = verifiedAccount
      ? verifiedAccount.id
      : await insertVerifiedAccountCode({ networkId, code });
    const verifiedAccountComponent = await getVerifiedAccountComponent({
      verifiedAccountId,
      packageCommitment: commitment,
    });
    if (verifiedAccountComponent) {
      throw new Error("account component already verified");
    }
    const dbPackage = await getPackage(commitment);
    let packageId = dbPackage?.id;
    if (!packageId) {
      // Stored before the row so a package never exists without its
      // artifact. Keyed by commitment, so a retry after a failed insert just
      // rewrites the same object.
      await maspStore.put(commitment, Buffer.from(masp, "base64"));
      packageId = await insertPackage({
        name,
        type: kind,
        // Keeps the lockfile with the sources, so the record pins the
        // dependency versions that produced `commitment`.
        files: compiledFiles ?? files,
        commitment,
        manifest,
        entrypoint,
        builtWith: cargoMidenVersion,
      });
    }
    // Also for a package stored before it had a debug build. A failure is
    // logged and leaves the package without one: the release build alone is
    // what verifies.
    if (!dbPackage?.debugCommitment) {
      await storeDebugBuild({ maspStore, packageId, commitment, debug }).catch(
        (error) => console.error(error),
      );
    }
    await insertVerifiedAccountComponent({
      verifiedAccountId,
      packageId,
      packageCommitment: commitment,
      source,
    });
  }
  return verified;
};
