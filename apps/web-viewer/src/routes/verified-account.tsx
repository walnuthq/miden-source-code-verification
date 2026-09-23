import { getNetworkName } from "miden-source-code-verification-utils/networks";
import { data, isRouteErrorResponse } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { NotVerified } from "@/components/not-verified";
import { ResourceHeader } from "@/components/resource-header";
import { getVerifiedAccount } from "@/lib/api-registry.server";
import type { Route } from "./+types/verified-account";

export async function loader({ params }: Route.LoaderArgs) {
  const { networkId, accountId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    throw data(null, { status: 404 });
  }
  // Awaited rather than streamed so a missing account gets a real 404 status,
  // which can't be sent once the page has started streaming.
  const verifiedAccount = await getVerifiedAccount({ networkId, accountId });
  if (!verifiedAccount) {
    throw data(null, { status: 404 });
  }
  // Only what the page renders: the record carries every component's sources
  // and compiled package, which would otherwise be serialized into the HTML.
  return { accountId, networkName };
}

// From the URL rather than loaderData, so the 404 page keeps the same title.
export const meta: Route.MetaFunction = ({ params }) => {
  const { accountId, networkId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    return [{ title: "Miden Source Code Verification Web Viewer" }];
  }
  return [
    { title: `${accountId} on ${networkName}` },
    {
      name: "description",
      content: `View account ${accountId} on Miden ${networkName}`,
    },
  ];
};

export default function VerifiedAccount({ loaderData }: Route.ComponentProps) {
  const { accountId, networkName } = loaderData;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader id={accountId} networkName={networkName} />
    </main>
  );
}

// A 404 on a known network means the registry has no verified account for the
// id (which includes ids that don't resolve on-chain). Unknown networks and
// other errors get the app-wide error page.
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  const { accountId, networkId } = params;
  const networkName = getNetworkName(networkId);
  if (!networkName || !isRouteErrorResponse(error) || error.status !== 404) {
    return <ErrorPage error={error} />;
  }
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader id={accountId} networkName={networkName} />
      <NotVerified kind="account" id={accountId} networkId={networkId} />
    </main>
  );
}
