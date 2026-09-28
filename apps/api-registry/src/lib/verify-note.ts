import { join } from "node:path";
import { parseCargoToml } from "miden-source-code-verification-utils";
import type {
  Manifest,
  TargetType,
} from "miden-source-code-verification-utils/manifest";
import { getPackage, insertPackage } from "@/db/packages.js";
import {
  getVerifiedNoteByScript,
  insertVerifiedNoteScript,
} from "@/db/verified-notes.js";
import { fetchApiCompile } from "@/lib/api-compile.js";
import { importResource } from "@/lib/import-resource.js";

export const verifyNote = async ({
  networkId,
  noteId,
  files,
  entrypoint = ".",
  source = "unknown",
}: {
  networkId: string;
  noteId: string;
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
      entrypoint,
      networkId,
      resourceId: noteId,
    }),
  });
  if (verified) {
    const { code: script } = await importResource({
      networkId,
      resourceId: noteId,
    });
    const verifiedNote = await getVerifiedNoteByScript({ networkId, script });
    if (verifiedNote) {
      throw new Error("note already verified");
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
    await insertVerifiedNoteScript({
      networkId,
      script,
      source,
      packageId,
      packageDigest: digest,
    });
  }
  return verified;
};
