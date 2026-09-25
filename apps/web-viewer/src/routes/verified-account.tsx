import { getNetworkName } from "miden-source-code-verification-utils/networks";
import { encodeAddress } from "miden-source-code-verification-utils/resource-id";
import { data, isRouteErrorResponse } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { NotVerified } from "@/components/not-verified";
import { ResourceHeader } from "@/components/resource-header";
import { PackageSection } from "@/components/source-code/package-section";
import { getVerifiedAccount } from "@/lib/api-registry.server";
import { getExplorerUrl } from "@/lib/constants";
import { loadPackageSources } from "@/lib/package-sources.server";
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
  // Only what the page uses: each component's displayed sources, already
  // highlighted, and its raw files for the download. The raw record also
  // carries every package's compiled `.masp`, which would otherwise be
  // serialized into the HTML.
  const packages = await Promise.all(
    verifiedAccount.verifiedAccountComponents.map((component) =>
      loadPackageSources(component.package),
    ),
  );
  return { accountId, networkId, networkName, packages };
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
  const { accountId, networkId, networkName, packages } = loaderData;
  const address = encodeAddress(networkId, accountId) ?? undefined;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader
        kind="account"
        id={accountId}
        networkName={networkName}
        address={address}
        explorerUrl={address && getExplorerUrl(networkId, "account", address)}
        verified
      />
      <section className="mt-8 flex flex-col gap-4">
        <h2 className="text-base font-semibold md:text-lg">
          Custom Account Component Packages
        </h2>
        {packages.map((pkg) => (
          <PackageSection
            key={pkg.name}
            pkg={pkg}
            networkId={networkId}
            resourceId={accountId}
          />
        ))}
      </section>
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
  // No explorer link: the account may not exist on-chain.
  const address = encodeAddress(networkId, accountId) ?? undefined;
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader
        kind="account"
        id={accountId}
        networkName={networkName}
        address={address}
      />
      <NotVerified kind="account" id={accountId} networkId={networkId} />
    </main>
  );
}
