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
import { importResource } from "@/lib/import-resource.js";

export const verifyAccountComponent = async ({
  networkId,
  accountId,
  files,
  entrypoint = ".",
  source = "unknown",
}: {
  networkId: string;
  accountId: string;
  files: Record<string, string>;
  entrypoint?: string;
  source?: string;
}) => {
  const cargoTomlPath = join(entrypoint, "Cargo.toml");
  const cargoToml = files[cargoTomlPath] ?? "";
  const {
    package: { name },
  } = parseCargoToml(cargoToml);
  const { verified, masp, digest, kind, manifest } = await fetchApiCompile<{
    verified: boolean;
    masp: string;
    digest: string;
    // The compiled package's own kind, stored as the package's type.
    kind: TargetType;
    manifest: Manifest;
  }>("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      networkId,
      resourceId: accountId,
      entrypoint,
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
      packageDigest: digest,
    });
    if (verifiedAccountComponent) {
      throw new Error("account component already verified");
    }
    const dbPackage = await getPackage(digest);
    const packageId = dbPackage
      ? dbPackage.id
      : await insertPackage({
          name,
          type: kind,
          files,
          masp,
          digest,
          manifest,
        });
    await insertVerifiedAccountComponent({
      verifiedAccountId,
      packageId,
      packageDigest: digest,
      source,
    });
  }
  return verified;
};
