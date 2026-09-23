import { getNetworkName } from "miden-source-code-verification-utils/networks";
import { data, isRouteErrorResponse } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { NotVerified } from "@/components/not-verified";
import { ResourceHeader } from "@/components/resource-header";
import { getVerifiedNote } from "@/lib/api-registry.server";
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
  // Only what the page renders: the record carries the package's sources and
  // compiled `.masp`, which would otherwise be serialized into the HTML.
  return { noteId, networkName };
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
  const { noteId, networkName } = loaderData;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader id={noteId} networkName={networkName} />
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
      <ResourceHeader id={noteId} networkName={networkName} />
      <NotVerified kind="note" id={noteId} networkId={networkId} />
    </main>
  );
}
