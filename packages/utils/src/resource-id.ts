import { bech32m, hex } from "@scure/base";

import { getNetworkName } from "./networks.js";

// Resource ID parsing for web-verifier's and web-viewer's forms. Addresses are
// decoded in TypeScript following miden-protocol's `Address` encoding, so
// neither app needs the Miden SDK (WASM).

// A Resource ID is valid when it is one of:
//  - an account ID in hex: "0x" followed by 30 hex digits
//  - a note ID in hex: "0x" followed by 64 hex digits
//  - a bech32 account address (see `decodeAddress`)
export const ACCOUNT_ID_REGEX = /^0x[0-9a-fA-F]{30}$/;
export const NOTE_ID_REGEX = /^0x[0-9a-fA-F]{64}$/;
// HTML `pattern` shape check for the forms' Resource ID input. The address
// alternative only matches the bech32 *shape* (HRP "1" data charset, then any
// routing parameters); `decodeAddress` does the authoritative checksum check.
export const RESOURCE_ID_PATTERN =
  "0x[0-9a-fA-F]{30}|0x[0-9a-fA-F]{64}|[a-z]+1[02-9ac-hj-np-z]{6,}(_.*)?";

// miden-protocol `AddressType::AccountId`, the first byte of an address payload.
const ACCOUNT_ID_ADDRESS_TYPE = 232;
// Address type byte + the 15-byte account ID.
const ACCOUNT_ADDRESS_LENGTH = 16;

// Decodes a Miden account address: bech32m with the network as HRP and
// [address type, ...account ID bytes] as data, optionally followed by
// "_<routing parameters>". Returns null for anything else, including a bad
// checksum.
export function decodeAddress(
  value: string,
): { networkId: string; accountId: string } | null {
  // Routing parameters don't change which account the address points to.
  const [encodedId = ""] = value.trim().split("_");
  try {
    const { prefix, bytes } = bech32m.decodeToBytes(encodedId);
    if (
      bytes.length !== ACCOUNT_ADDRESS_LENGTH ||
      bytes[0] !== ACCOUNT_ID_ADDRESS_TYPE
    ) {
      return null;
    }
    return { networkId: prefix, accountId: `0x${hex.encode(bytes.slice(1))}` };
  } catch {
    return null; // not an address (hex ID, note ID, partial input, …)
  }
}

// If the value is a valid Miden account address on a network the registry
// serves, return that network (e.g. "mtst" / "mdev"); otherwise null.
export function detectNetwork(value: string): string | null {
  const networkId = decodeAddress(value)?.networkId;
  return networkId && getNetworkName(networkId) ? networkId : null;
}

export type ResourceId =
  | { kind: "account"; accountId: string }
  | { kind: "note"; noteId: string };

// The resource a Resource ID points to, or null when it isn't one. Account IDs
// are in canonical hex: an address is resolved to the account ID it encodes.
export function parseResourceId(value: string): ResourceId | null {
  const trimmed = value.trim();
  if (NOTE_ID_REGEX.test(trimmed)) {
    return { kind: "note", noteId: trimmed };
  }
  if (ACCOUNT_ID_REGEX.test(trimmed)) {
    return { kind: "account", accountId: trimmed };
  }
  const address = decodeAddress(trimmed);
  return address && { kind: "account", accountId: address.accountId };
}
