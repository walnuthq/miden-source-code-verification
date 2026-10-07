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
  const {
    verified,
    masp,
    commitment,
    kind,
    manifest,
    files: compiledFiles,
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
    const dbPackage = await getPackage(commitment);
    const packageId = dbPackage
      ? dbPackage.id
      : await insertPackage({
          name,
          type: kind,
          // Keeps the lockfile with the sources, so the record pins the
          // dependency versions that produced `commitment`.
          files: compiledFiles ?? files,
          masp,
          commitment,
          manifest,
        });
    await insertVerifiedNoteScript({
      networkId,
      script,
      source,
      packageId,
      packageCommitment: commitment,
    });
  }
  return verified;
};
