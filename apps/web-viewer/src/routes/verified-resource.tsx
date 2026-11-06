import { getNetworkName } from "miden-source-code-verification-utils/networks";
import {
  encodeAddress,
  type ResourceId,
} from "miden-source-code-verification-utils/resource-id";
import { isRouteErrorResponse } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { NotVerified } from "@/components/not-verified";
import { ResourceHeader } from "@/components/resource-header";
import { PackageSection } from "@/components/source-code/package-section";
import { getExplorerUrl } from "@/lib/constants";
import { loadResourcePage } from "@/lib/resource-page.server";
import type { Route } from "./+types/verified-resource";

// One page for both verified resource kinds: the file is registered under
// `/:networkId/verified-accounts/:accountId` and `/:networkId/verified-notes/:noteId`
// (routes.ts), so its params are either route's.
type Params = Route.LoaderArgs["params"];

// The resource a page is for: the account route has `accountId`, the note
// route `noteId`.
const resourceOf = (params: Params): ResourceId =>
  params.accountId !== undefined
    ? { kind: "account", accountId: params.accountId }
    : { kind: "note", noteId: params.noteId };

const idOf = (resource: ResourceId) =>
  resource.kind === "account" ? resource.accountId : resource.noteId;

// An account is identified first by its address, when its id encodes to one on
// the network; a note only by its id.
const addressOf = (networkId: string, resource: ResourceId) =>
  resource.kind === "account"
    ? (encodeAddress(networkId, resource.accountId) ?? undefined)
    : undefined;

export async function loader({ params }: Route.LoaderArgs) {
  const { networkId } = params;
  const resource = resourceOf(params);
  const page = await loadResourcePage({ networkId, resource });
  return { networkId, resource, ...page };
}

// From the URL rather than loaderData, so the 404 page keeps the same title.
export const meta: Route.MetaFunction = ({ params }) => {
  const { networkId } = params;
  const resource = resourceOf(params);
  const networkName = getNetworkName(networkId);
  if (!networkName) {
    return [{ title: "Miden Source Code Verification Web Viewer" }];
  }
  return [
    { title: `${idOf(resource)} on ${networkName}` },
    {
      name: "description",
      content: `View ${resource.kind} ${idOf(resource)} on Miden ${networkName}`,
    },
  ];
};

export default function VerifiedResource({ loaderData }: Route.ComponentProps) {
  const {
    networkId,
    resource,
    networkName,
    packages,
    verificationStatus,
    standardAccountComponents,
  } = loaderData;
  const { kind } = resource;
  const id = idOf(resource);
  const address = addressOf(networkId, resource);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ResourceHeader
        kind={kind}
        id={id}
        networkName={networkName}
        address={address}
        explorerUrl={
          kind === "account"
            ? address && getExplorerUrl(networkId, kind, address)
            : getExplorerUrl(networkId, kind, id)
        }
        verified
        verificationStatus={verificationStatus}
        standardAccountComponents={standardAccountComponents}
      />
      <section className="mt-8 flex flex-col gap-4">
        <h2 className="text-base font-semibold md:text-lg">
          {kind === "account"
            ? "Custom Account Component Packages"
            : "Custom Note Package"}
        </h2>
        {packages.map((pkg) => (
          <PackageSection
            key={pkg.name}
            pkg={pkg}
            networkId={networkId}
            resourceId={id}
          />
        ))}
      </section>
    </main>
  );
}

// A 404 on a known network means the registry has no verified record for the
// id (which includes ids that don't resolve on-chain). Unknown networks and
// other errors get the app-wide error page.
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  const { networkId } = params;
  const resource = resourceOf(params);
  const networkName = getNetworkName(networkId);
  if (!networkName || !isRouteErrorResponse(error) || error.status !== 404) {
    return <ErrorPage error={error} />;
  }
  const id = idOf(resource);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* No explorer link: the resource may not exist on-chain. */}
      <ResourceHeader
        kind={resource.kind}
        id={id}
        networkName={networkName}
        address={addressOf(networkId, resource)}
      />
      <NotVerified kind={resource.kind} id={id} networkId={networkId} />
    </main>
  );
}
