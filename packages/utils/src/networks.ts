// The networks the registry serves, keyed by the `networkId` segment of its
// routes, which is also the bech32 prefix of their addresses. Shared by
// web-verifier's and web-viewer's navbars and forms. Testnet is the default.
export const networks = [
  { label: "Testnet", value: "mtst" },
  { label: "Devnet", value: "mdev" },
  // { label: "Mainnet", value: "mm" },
] as const;

export type NetworkId = (typeof networks)[number]["value"];

export const DEFAULT_NETWORK: NetworkId = "mtst";

export function isNetworkId(value: unknown): value is NetworkId {
  return networks.some((network) => network.value === value);
}

// The `?network=` query param, falling back to the default for a missing or
// unknown value so a stale or hand-edited link still loads.
export function parseNetwork(value: string | null | undefined): NetworkId {
  return isNetworkId(value) ? value : DEFAULT_NETWORK;
}

export function getNetwork(networkId: NetworkId) {
  // biome-ignore lint/style/noNonNullAssertion: every NetworkId is in the list
  return networks.find((network) => network.value === networkId)!;
}

// The label of any `networkId` (e.g. a route segment), or undefined when the
// registry doesn't serve it.
export function getNetworkName(networkId: string) {
  return isNetworkId(networkId) ? getNetwork(networkId).label : undefined;
}
