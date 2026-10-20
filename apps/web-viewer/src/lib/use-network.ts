import {
  DEFAULT_NETWORK,
  isNetworkId,
  type NetworkId,
  parseNetwork,
} from "miden-source-code-verification-utils/networks";
import { useCallback } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

// `?network=` for a non-default network, and nothing for the default, to keep
// URLs clean.
export const networkSearch = (network: NetworkId) =>
  network === DEFAULT_NETWORK ? "" : `?network=${network}`;

// The selected network lives in the URL, so deep links and reloads carry it:
// a resource page's `:networkId` segment, or `?network=` elsewhere. Switching
// on a resource page opens the same resource on the other network.
export function useNetwork() {
  const { networkId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onResourcePage = isNetworkId(networkId);
  const network = onResourcePage
    ? networkId
    : parseNetwork(searchParams.get("network"));

  const setNetwork = useCallback(
    (next: NetworkId) => {
      if (onResourcePage) {
        navigate(pathname.replace(/^\/[^/]+/, `/${next}`));
        return;
      }
      setSearchParams(
        (params) => {
          if (next === DEFAULT_NETWORK) {
            params.delete("network");
          } else {
            params.set("network", next);
          }
          return params;
        },
        { replace: true },
      );
    },
    [onResourcePage, pathname, navigate, setSearchParams],
  );

  return [network, setNetwork] as const;
}
