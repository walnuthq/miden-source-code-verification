// The networks the registry serves, keyed by the `networkId` segment of its
// routes. Shared by web-verifier's and web-viewer's forms.
export const networks = [
  { label: "Devnet", value: "mdev" },
  { label: "Testnet", value: "mtst" },
  // { label: "Mainnet", value: "mm" },
];

export const DEFAULT_NETWORK = "mtst";

export function getNetworkName(networkId: string) {
  return networks.find((network) => network.value === networkId)?.label;
}
