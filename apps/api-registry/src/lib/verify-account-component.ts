import { join } from "node:path";
import { parseCargoToml } from "miden-source-code-verification-utils";
import { getPackage, insertPackage } from "@/db/packages.js";
import {
  getVerifiedAccountComponent,
  insertVerifiedAccountComponent,
} from "@/db/verified-account-components.js";
import {
  getVerifiedAccountByCode,
  insertVerifiedAccountCode,
} from "@/db/verified-accounts.js";
import { API_COMPILE_URL } from "@/lib/constants.js";
import { importResource } from "@/lib/import-resource.js";
import type { Manifest } from "@/lib/types.js";

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
  const response = await fetch(`${API_COMPILE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      networkId,
      resourceId: accountId,
      entrypoint,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const { error } = data as { error: string };
    throw new Error(error);
  }
  const { verified, masp, digest, manifest } = data as {
    verified: boolean;
    masp: string;
    digest: string;
    manifest: Manifest;
  };
  if (verified) {
    const { code } = await importResource({
      networkId,
      resourceId: accountId,
    });
    const verifiedAccount = await getVerifiedAccountByCode({ code });
    const verifiedAccountId = verifiedAccount
      ? verifiedAccount.id
      : await insertVerifiedAccountCode({ code, source });
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
          type: "account-component",
          files,
          masp,
          digest,
          manifest,
        });
    await insertVerifiedAccountComponent({
      verifiedAccountId,
      packageId,
      packageDigest: digest,
    });
  }
  return verified;
};
