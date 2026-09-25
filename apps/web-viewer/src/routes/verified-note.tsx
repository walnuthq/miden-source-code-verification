import { getNetworkName } from "miden-source-code-verification-utils/networks";
import { data, isRouteErrorResponse } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { NotVerified } from "@/components/not-verified";
import { ResourceHeader } from "@/components/resource-header";
import { PackageSection } from "@/components/source-code/package-section";
import { getVerifiedNote } from "@/lib/api-registry.server";
import { getExplorerUrl } from "@/lib/constants";
import { loadPackageSources } from "@/lib/package-sources.server";
import type { Route } from "./+types/verified-note";

export async function loader({ params }: Route.LoaderArgs) {
  const { networkId, noteId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    throw data(null, { status: 404 });
  }
  // Awaited rather than streamed so a missing note gets a real 404 status,
  // which can't be sent once the page has started streaming.
  const verifiedNote = await getVerifiedNote({ networkId, noteId });
  if (!verifiedNote) {
    throw data(null, { status: 404 });
  }
  // Only what the page uses: the package's displayed sources, already
  // highlighted, and its raw files for the download. The raw record also
  // carries its compiled `.masp`, which would otherwise be serialized into the
  // HTML. A list of one, so the page renders like an account's.
  const packages = [
    await loadPackageSources(verifiedNote.package, verifiedNote.createdAt),
  ];
  return { noteId, networkId, networkName, packages };
}

// From the URL rather than loaderData, so the 404 page keeps the same title.
export const meta: Route.MetaFunction = ({ params }) => {
  const { noteId, networkId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    return [{ title: "Miden Source Code Verification Web Viewer" }];
  }
  return [
    { title: `${noteId} on ${networkName}` },
    {
      name: "description",
      content: `View note ${noteId} on Miden ${networkName}`,
    },
  ];
};

export default function VerifiedNote({ loaderData }: Route.ComponentProps) {
  const { noteId, networkId, networkName, packages } = loaderData;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader
        kind="note"
        id={noteId}
        networkName={networkName}
        explorerUrl={getExplorerUrl(networkId, "note", noteId)}
        verified
        // A note's code is its single script, which verification matched.
        verificationStatus={{ verified: 1, total: 1 }}
      />
      <section className="mt-8 flex flex-col gap-4">
        <h2 className="text-base font-semibold md:text-lg">
          Custom Note Package
        </h2>
        {packages.map((pkg) => (
          <PackageSection
            key={pkg.name}
            pkg={pkg}
            networkId={networkId}
            resourceId={noteId}
          />
        ))}
      </section>
    </main>
  );
}

// A 404 on a known network means the registry has no verified note for the id
// (which includes ids that don't resolve on-chain). Unknown networks and other
// errors get the app-wide error page.
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  const { noteId, networkId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName || !isRouteErrorResponse(error) || error.status !== 404) {
    return <ErrorPage error={error} />;
  }
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader kind="note" id={noteId} networkName={networkName} />
      <NotVerified kind="note" id={noteId} networkId={networkId} />
    </main>
  );
}
