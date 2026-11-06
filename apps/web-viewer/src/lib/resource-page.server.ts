import type { Package } from "miden-source-code-verification-utils/api-registry";
import { getNetworkName } from "miden-source-code-verification-utils/networks";
import type { ResourceId } from "miden-source-code-verification-utils/resource-id";
import { data } from "react-router";

import { getVerifiedRecord } from "@/lib/api-registry.server";
import { loadPackageSources } from "@/lib/package-sources.server";
import type { PackageSources } from "@/lib/source-files";
import {
  getVerificationStatus,
  type VerificationStatus,
} from "@/lib/verification-status";

// What a verified resource's page shows, account or note: the network's name,
// each verified package's sources, and how much of the resource's code the
// packages account for. Worked out on the server so the record (its procedure
// lists, manifests and every file) stays there: the page gets the counts, the
// standard components' names and the displayed sources, already highlighted.
export type ResourcePage = {
  networkName: string;
  packages: PackageSources[];
  verificationStatus: VerificationStatus;
  standardAccountComponents: string[];
};

// What the record says of the resource, where the kinds differ: which records
// verify a package against it (an account's components, or the note itself),
// and the verification status. Null when the registry has no record.
type VerifiedRecord = Pick<
  ResourcePage,
  "verificationStatus" | "standardAccountComponents"
> & {
  components: { package: Package; createdAt: string; source: string }[];
};

// Throws a 404 for a network the registry doesn't serve and for a resource it
// has no verified record of, which includes ids that don't resolve on-chain.
// Awaited rather than streamed so the 404 is a real status, which can't be sent
// once the page has started streaming.
export async function loadResourcePage({
  networkId,
  resource,
}: {
  networkId: string;
  resource: ResourceId;
}): Promise<ResourcePage> {
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    throw data(null, { status: 404 });
  }
  const record = await (resource.kind === "account"
    ? verifiedAccountRecord(networkId, resource)
    : verifiedNoteRecord(networkId, resource));
  if (!record) {
    throw data(null, { status: 404 });
  }
  const { components, verificationStatus, standardAccountComponents } = record;
  // Only what the page uses: each package's displayed sources, already
  // highlighted, and its raw files for the download.
  const packages = await Promise.all(
    components.map((component) =>
      loadPackageSources(component.package, component),
    ),
  );
  return {
    networkName,
    packages,
    verificationStatus,
    standardAccountComponents,
  };
}

// An account's code is made of its verified components and the standard
// components the import found; the status counts how many of its procedures
// they account for.
async function verifiedAccountRecord(
  networkId: string,
  resource: Extract<ResourceId, { kind: "account" }>,
): Promise<VerifiedRecord | null> {
  const account = await getVerifiedRecord({ networkId, resource });
  if (!account) {
    return null;
  }
  const components = account.verifiedAccountComponents;
  return {
    components,
    verificationStatus: getVerificationStatus({
      procedures: account.procedures,
      standardAccountComponents: account.standardAccountComponents,
      manifests: components.map((component) => component.package.manifest),
    }),
    standardAccountComponents: account.standardAccountComponents.map(
      ({ name }) => name,
    ),
  };
}

// A note's code is its single script, which verification matched: one package,
// fully verified. A list of one, so the page renders like an account's.
async function verifiedNoteRecord(
  networkId: string,
  resource: Extract<ResourceId, { kind: "note" }>,
): Promise<VerifiedRecord | null> {
  const note = await getVerifiedRecord({ networkId, resource });
  if (!note) {
    return null;
  }
  return {
    components: [note],
    verificationStatus: { verified: 1, total: 1 },
    standardAccountComponents: [],
  };
}
