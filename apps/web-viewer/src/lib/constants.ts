// The sibling web-verifier app, linked from the navbar. Baked in at build time
// (unlike constants.server.ts) so both the server and client bundles have it,
// including on the 404 page, which renders without any loader data.
export const WEB_VERIFIER_URL =
  import.meta.env.VITE_WEB_VERIFIER_URL ?? "http://localhost:5173";

// The block explorer for each network the registry serves, keyed by network ID.
// Baked in at build time like WEB_VERIFIER_URL.
const EXPLORER_URLS: Record<string, string> = {
  mtst:
    import.meta.env.VITE_EXPLORER_TESTNET_URL ??
    "https://testnet.midenscan.com",
  mdev:
    import.meta.env.VITE_EXPLORER_DEVNET_URL ?? "https://devnet.midenscan.com",
};

// A resource's page on its network's explorer, or undefined for a network
// without one. Accounts are identified by their address, notes by their ID.
export function getExplorerUrl(
  networkId: string,
  kind: "account" | "note",
  id: string,
) {
  const explorerUrl = EXPLORER_URLS[networkId];
  return explorerUrl && `${explorerUrl}/${kind}/${id}`;
}
