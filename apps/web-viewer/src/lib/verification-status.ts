import type {
  PackageManifest,
  StandardAccountComponent,
} from "@/lib/api-registry.server";

// How many of an account's procedures are accounted for by a known component.
export type VerificationStatus = { verified: number; total: number };

// Only the procedures a package exports with the ComponentModel calling
// convention (abi 3) are installed as account procedures; the rest of its
// exports are toolchain internals (see the verifier's `verify_account_component`).
const ACCOUNT_PROCEDURE_ABI = 3;

// An account's procedures, counted as verified when a standard component or a
// verified package accounts for them. Digests are compared as a set, so a
// procedure claimed by more than one component still counts once and the count
// never exceeds the total.
export function getVerificationStatus({
  procedures,
  standardAccountComponents,
  manifests,
}: {
  procedures: string[];
  standardAccountComponents: StandardAccountComponent[];
  manifests: PackageManifest[];
}): VerificationStatus {
  const known = new Set(
    [
      ...standardAccountComponents.flatMap((component) => component.procedures),
      ...manifests.flatMap(({ exports }) =>
        exports.flatMap(({ Procedure }) =>
          Procedure?.signature?.abi === ACCOUNT_PROCEDURE_ABI
            ? [Procedure.digest]
            : [],
        ),
      ),
    ].map((digest) => digest.toLowerCase()),
  );
  const accountProcedures = new Set(
    procedures.map((digest) => digest.toLowerCase()),
  );
  const verified = [...accountProcedures].filter((digest) =>
    known.has(digest),
  ).length;
  return { verified, total: accountProcedures.size };
}
