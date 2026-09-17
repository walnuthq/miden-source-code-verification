# Migrating from the legacy Contract Verification API

This guide is for consumers of the legacy **Miden Contract Verification API**
(`miden-playground-api.walnut.dev`) who want to read verified data from the new
**Miden Source Code Verification** registry (`api-registry`).

It only covers the read (`GET`) endpoints. The full reference for the new API is
published as OpenAPI docs (`apps/api-docs`).

## What changed at a glance

|                                          | Legacy                                        | New                                                      |
| ---------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| Path prefix                              | none                                          | `/v1`                                                    |
| Records keyed by                         | account address / note id                     | network + **code** (account code root, note script root) |
| Account resource name                    | `verified-account-components`                 | `verified-accounts`                                      |
| Response wrapper                         | `{ components }` / `{ noteScript }`           | the record itself, unwrapped                             |
| Not found                                | returns standard components / `null`          | `404` with `{ "error": … }`                              |
| Standard component / note auto-detection | yes                                           | **no** — only previously verified records are returned   |
| Source code fields                       | separate `rust` + `masm`                      | single `files` map (path → contents); no `masm`          |
| Exports / dependencies                   | `exports`, `procedureExports`, `dependencies` | nested under `manifest`                                  |
| Errors                                   | plain text, always `500`                      | JSON `{ "error" }` with proper `400` / `404` / `500`     |
| Timestamps                               | epoch milliseconds (number)                   | ISO 8601 strings                                         |

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

Two things to know:

1. The `{accountId}` segment accepts either the on-chain **account id** (hex,
   e.g. `0xd42901fd1841424000901c7741f24d`) or the **bech32 address** you
   already pass today (`mtst1ar2zjq0arpq5ysqqjqw8ws0jf5fygx84`) — both are
   resolved on-chain to the account's code root, which is what the registry is
   keyed on. An address carries its own network, which must match the
   `{networkId}` in the path. Whatever you pass is echoed back verbatim as
   `accountId`.
2. The response is the account record directly — the verified components live
   under `verifiedAccountComponents[].package`, not a top-level `components`
   array. There is no automatic list of standard components.

Because the match is by code, the record you get back may have been created by
a **different** account on the same network that shares the same code.

New response shape:

```jsonc
{
  "id": "…",
  "networkId": "mtst",
  // the account code root the record is keyed on
  "code": "0x9f1c…",
  // client that submitted the verification ("unknown" by default)
  "source": "web-verifier",
  "createdAt": "2026-02-23T12:34:28.801Z",
  "updatedAt": "2026-02-23T12:34:28.801Z",
  "verifiedAccountComponents": [
    {
      "id": "…",
      "verifiedAccountId": "…",
      "packageId": "…",
      "packageDigest": "0x7f70…",
      "createdAt": "2026-02-23T12:34:28.801Z",
      "updatedAt": "2026-02-23T12:34:28.801Z",
      "package": {
        /* Package, see below */
      },
    },
  ],
  // the id (or address) you queried with, echoed back
  "accountId": "0xd42901fd1841424000901c7741f24d",
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
— only notes previously verified through the API are returned. As with
accounts, the match is by script root, so the record may have originated from
another note on the same network sharing that script.

New response shape:

```jsonc
{
  "id": "…",
  "networkId": "mtst",
  // the note script root the record is keyed on
  "script": "0x4ab8…",
  // client that submitted the verification ("unknown" by default)
  "source": "web-verifier",
  "packageId": "…",
  "packageDigest": "0xb32e…",
  "createdAt": "2026-03-26T…Z",
  "updatedAt": "2026-03-26T…Z",
  "package": {
    /* Package, see below */
  },
  // the id you queried with, echoed back
  "noteId": "0xcc3f…",
}
```

## Looking up by code directly

The registry stores records per network and **code** — an account's code root or
a note's script root — not per account/note id. The two lookups above are
convenience resolvers: they call the internal compilation API to resolve
`{accountId}` / `{noteId}` to that code first, then return the record.

If you already have the code, address it directly and skip that round-trip:

```
GET /v1/{networkId}/verified-accounts/code/{code}      → VerifiedAccount  (404 if not verified)
GET /v1/{networkId}/verified-notes/script/{script}     → VerifiedNote     (404 if not verified)
```

Differences from the id-keyed lookups:

- No call to the compilation API — this is a single database query, and it works
  even when that service is down.
- The response is the record itself, **without** the `accountId` / `noteId` echo
  field: no id was supplied to echo. The `code` / `script` the record is keyed
  on is still there, as is `networkId`.
- The code is `0x` followed by 64 hex characters (32 bytes), matched
  case-insensitively. Anything else returns `400` — which is what you get if you
  pass an account **id** here, since ids are shorter. (Note ids happen to be the
  same width as script roots, so those return `404` instead.)

A code root only means something within the network it was read from, so
`networkId` is required here just as it is on the id-keyed lookups. Asking for a
root on a network it was never verified against returns `404`, never another
network's record.

The legacy API had no equivalent — it only looked resources up by address/id —
but this is the cheapest read available: one database query, no compilation-API
call.

## The `Package` object

The package shape is shared by both endpoints and is slimmer than before:

```jsonc
{
  "id": "…",
  "name": "bank-account",
  // library | account-component | authentication-component | note | tx-script.
  // Verification only ever records `account-component` or `note`.
  "type": "account-component",
  "digest": "0x7f70…",
  "masp": "MASP_BINARY_BASE64",
  "files": {
    // replaces `rust` + `masm`: the exact project inputs that were compiled
    "Cargo.toml": "…",
    "miden-project.toml": "…",
    "src/lib.rs": "RUST_SOURCE_CODE",
  },
  "manifest": {
    // replaces `exports` / `procedureExports` / `dependencies`
    "exports": [
      {
        "Procedure": {
          "path": "::\"miden:bank-account/bank-account@0.1.0\"::\"get-balance\"",
          "digest": "0x6370…",
          // null when the compiler could not recover a signature
          "signature": { "abi": 3, "params": ["Felt"], "results": ["Felt"] },
          "attributes": { "attrs": [] },
        },
      },
    ],
    "dependencies": [
      {
        "name": "counter-account",
        "kind": "account-component",
        "version": "0.1.0",
        "digest": "0x731c…",
      },
    ],
  },
  "createdAt": "2026-02-23T…Z",
  "updatedAt": "2026-02-23T…Z",
}
```

Field mapping from the legacy `Package`:

| Legacy                               | New                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `rust`                               | read from `files` (e.g. `files["src/lib.rs"]`)                                      |
| `masm`                               | gone — `masp` is the only build output kept                                         |
| `exports`                            | `manifest.exports`                                                                  |
| `procedureExports`                   | gone — every entry of `manifest.exports` is a `Procedure`, so map over `.Procedure` |
| `dependencies`                       | `manifest.dependencies` (`{ name, kind, version, digest }`, no source code)         |
| `type`                               | same field, renamed values: `account` → `account-component`; `library` added        |
| `id`                                 | registry uuid — the legacy ids of standard components (`auth-no-auth`, …) are gone  |
| `masp`, `digest`, `name`             | unchanged                                                                           |
| `status`, `readOnly`                 | removed                                                                             |
| `createdAt`, `updatedAt` (ms number) | ISO 8601 string                                                                     |

## Error handling

Replace "any non-200 means error" logic with proper status handling:

- `404` → the contract/note has not been verified (previously you'd get standard
  components or `null`). On the id-keyed lookups this also covers "the id could
  not be resolved on-chain" — an unknown or malformed id, an account or note
  the node does not return, or the compilation API being unreachable. The
  code-keyed lookups never depend on that service.
- `400` → bad request. On reads this only comes from the code/script-keyed
  lookups, when the value isn't a 32-byte hex root.
- `500` → retrieval failure (e.g. the database is unavailable).

All error bodies are now JSON: `{ "error": "<message>" }`.
