# Migrating from the legacy Contract Verification API

This guide is for consumers of the legacy **Miden Contract Verification API**
(`miden-playground-api.walnut.dev`) who want to read verified data from the new
**Miden Source Code Verification** registry (`api-registry`).

It only covers the read (`GET`) endpoints. The full reference for the new API is
published as OpenAPI docs (`apps/api-docs`).

## What changed at a glance

|                                          | Legacy                                        | New                                                    |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Path prefix                              | none                                          | `/v1`                                                  |
| Account lookup keyed by                  | bech32 **address** (`mtst1ar2…`)              | on-chain **account id** (`0xd429…`)                    |
| Account resource name                    | `verified-account-components`                 | `verified-accounts`                                    |
| Response wrapper                         | `{ components }` / `{ noteScript }`           | the record itself, unwrapped                           |
| Not found                                | returns standard components / `null`          | `404` with `{ "error": … }`                            |
| Standard component / note auto-detection | yes                                           | **no** — only previously verified records are returned |
| Source code fields                       | separate `rust` + `masm`                      | single `files` map (path → contents)                   |
| Exports / dependencies                   | `exports`, `procedureExports`, `dependencies` | nested under `manifest`                                |
| Errors                                   | plain text, always `500`                      | JSON `{ "error" }` with proper `400` / `404` / `500`   |
| Timestamps                               | epoch milliseconds (number)                   | ISO 8601 strings                                       |

The `network` segment (`mtst`, `mdev`) is unchanged.

## Verified account lookup

**Legacy**

```
GET /verified-account-components/{network}/{address}
→ { "components": Package[] }
```

**New**

```
GET /v1/{networkId}/verified-accounts/{accountId}
→ VerifiedAccount   (404 if not verified)
```

Two things to change:

1. Look up by the on-chain **account id** (hex, e.g.
   `0xd42901fd1841424000901c7741f24d`) instead of the bech32 address.
2. The response is the account record directly — the verified components live
   under `verifiedAccountComponents[].package`, not a top-level `components`
   array. There is no automatic list of standard components.

New response shape:

```jsonc
{
  "id": "…",
  "networkId": "mtst",
  "accountId": "0xd42901fd1841424000901c7741f24d",
  "createdAt": "2026-02-23T12:34:28.801Z",
  "updatedAt": "2026-02-23T12:34:28.801Z",
  "verifiedAccountComponents": [
    {
      "packageId": "…",
      "packageDigest": "0x7f70…",
      "package": {
        /* Package, see below */
      },
    },
  ],
}
```

## Verified note lookup

**Legacy**

```
GET /verified-notes/{network}/{id}
→ { "noteScript": Package | null }
```

**New**

```
GET /v1/{networkId}/verified-notes/{noteId}
→ VerifiedNote   (404 if not verified)
```

The response is the note record directly; what used to be `noteScript` is now
the `package` field. Well-known notes (p2id, swap, …) are **not** auto-detected
— only notes previously verified through the API are returned.

New response shape:

```jsonc
{
  "id": "…",
  "networkId": "mtst",
  "noteId": "0xcc3f…",
  "packageId": "…",
  "packageDigest": "0xb32e…",
  "createdAt": "2026-03-26T…Z",
  "updatedAt": "2026-03-26T…Z",
  "package": {
    /* Package, see below */
  },
}
```

## The `Package` object

The package shape is shared by both endpoints and is slimmer than before:

```jsonc
{
  "id": "…",
  "name": "bank-account",
  "type": "account", // account | note | tx-script | authentication-component
  "digest": "0x7f70…",
  "masp": "MASP_BINARY_BASE64",
  "files": {
    // replaces `rust` + `masm`
    "Cargo.toml": "…",
    "src/lib.rs": "RUST_SOURCE_CODE",
  },
  "manifest": {
    // replaces `exports` / `procedureExports` / `dependencies`
    "exports": [
      {
        "Procedure": {
          "path": "::\"miden:bank-account/bank-account@0.1.0\"::\"get-balance\"",
          "digest": "0x6370…",
          "signature": { "abi": 3, "params": ["Felt"], "results": ["Felt"] },
          "attributes": { "attrs": [] },
        },
      },
    ],
    "dependencies": [{ "name": "counter-account", "digest": "0x731c…" }],
  },
  "createdAt": "2026-02-23T…Z",
  "updatedAt": "2026-02-23T…Z",
}
```

Field mapping from the legacy `Package`:

| Legacy                               | New                                                   |
| ------------------------------------ | ----------------------------------------------------- |
| `rust`, `masm`                       | read from `files` (e.g. `files["src/lib.rs"]`)        |
| `exports`, `procedureExports`        | `manifest.exports`                                    |
| `dependencies`                       | `manifest.dependencies` (now just `{ name, digest }`) |
| `masp`, `digest`, `name`, `type`     | unchanged                                             |
| `status`, `readOnly`                 | removed                                               |
| `createdAt`, `updatedAt` (ms number) | ISO 8601 string                                       |

## Error handling

Replace "any non-200 means error" logic with proper status handling:

- `404` → the contract/note has not been verified (previously you'd get standard
  components or `null`).
- `400` → bad request.
- `500` → verification/retrieval failure.

All error bodies are now JSON: `{ "error": "<message>" }`.
