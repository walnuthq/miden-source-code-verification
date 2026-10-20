import {
  Footer,
  Navbar,
  NetworkSelect,
} from "miden-source-code-verification-ui";
import {
  DEFAULT_NETWORK,
  type NetworkId,
  parseNetwork,
} from "miden-source-code-verification-utils/networks";
import { useCallback, useState } from "react";

import { VerifyForm } from "@/components/verify-form/verify-form";
import { WEB_VIEWER_URL } from "@/lib/constants";

// `?network=` for a non-default network, and nothing for the default, to keep
// URLs clean.
const networkSearch = (network: NetworkId) =>
  network === DEFAULT_NETWORK ? "" : `?network=${network}`;

export function App() {
  // The selected network lives in the URL (`?network=`), so a reload or a
  // link from the web-viewer keeps it. There's no router: it's read once on
  // mount and written back with `replaceState`.
  const [network, setNetworkState] = useState(() =>
    parseNetwork(new URLSearchParams(window.location.search).get("network")),
  );
  const setNetwork = useCallback((next: NetworkId) => {
    setNetworkState(next);
    const url = new URL(window.location.href);
    if (next === DEFAULT_NETWORK) {
      url.searchParams.delete("network");
    } else {
      url.searchParams.set("network", next);
    }
    window.history.replaceState(window.history.state, "", url);
  }, []);

  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <Navbar
        title="Miden Source Code Verification Web Verifier"
        link={{
          label: "Browse Registry",
          href: `${WEB_VIEWER_URL}${networkSearch(network)}`,
        }}
      >
        <NetworkSelect value={network} onValueChange={setNetwork} />
      </Navbar>
      <VerifyForm network={network} onNetworkChange={setNetwork} />
      <Footer />
    </div>
  );
}

export default App;
