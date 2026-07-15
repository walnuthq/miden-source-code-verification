import { join } from "node:path";
import { insertPackage, getPackage } from "@/db/packages.js";
import {
  getVerifiedNoteByScript,
  insertVerifiedNoteScript,
} from "@/db/verified-notes.js";
import { API_COMPILE_URL } from "@/lib/constants.js";
import { importResource } from "@/lib/import-resource.js";
import type { Manifest } from "@/lib/types.js";
import { parseCargoToml } from "miden-source-code-verification-utils";

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
  const response = await fetch(`${API_COMPILE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      entrypoint,
      networkId,
      resourceId: noteId,
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
    const { code: script } = await importResource({
      networkId,
      resourceId: noteId,
    });
    const verifiedNote = await getVerifiedNoteByScript({ script });
    if (verifiedNote) {
      throw new Error("note already verified");
    }
    const dbPackage = await getPackage(digest);
    const packageId = dbPackage
      ? dbPackage.id
      : await insertPackage({
          name,
          type: "note",
          files,
          masp,
          digest,
          manifest,
        });
    await insertVerifiedNoteScript({
      script,
      source,
      packageId,
      packageDigest: digest,
    });
  }
  return verified;
};
