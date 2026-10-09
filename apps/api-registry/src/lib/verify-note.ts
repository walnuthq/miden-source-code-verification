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
import type { MaspStore } from "@/storage/masp-store.js";

export const verifyNote = async ({
  networkId,
  noteId,
  files,
  entrypoint = ".",
  source = "unknown",
  maspStore,
}: {
  networkId: string;
  noteId: string;
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
      });
    }
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
