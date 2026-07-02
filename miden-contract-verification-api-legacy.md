# [Public] Miden Contract Verification API

Base URL: [https://miden-playground-api.walnut.dev](https://miden-playground-api.walnut.dev)

CORS Access-Control-Allow-Origin:

- [https://playground.miden.xyz](https://playground.miden.xyz)
- [https://testnet.midenscan.com, https://devnet.midenscan.com](https://testnet.midenscan.com/)
- [https://explorer.devnet.miden.io](https://explorer.devnet.miden.io/), [https://explorer.testnet.miden.io](https://explorer.testnet.miden.io/)

All endpoints accept a JSON body request and return a JSON response.

Custom types:

```tsx
type PackageType = "account" | "note-script" | "transaction-script" | "authentication-component";

type PackageDependency = {
  id: string;
  name: string;
  type: PackageType;
  digest: string;
  rust: string;
};

type Package = {
  id: string;
  name: string;
  type: PackageType;
  status: "draft" | "compiled" | "error";
  readOnly: boolean;
  rust: string;
  masm: string;
  digest: string;
  masp: string;
  exports: {
    Procedure: {
      path: string;
   	  digest: string;
	    signature: { abi: number; params: string[]; results: string[] };
	    attributes: { attrs: string[] };
    }
  }[];
  // list of dependencies this package depends on
  dependencies: PackageDependency[];
  createdAt: number;
  updatedAt: number;
  // exports filtered by "Procedure" type
  procedureExports: {
    path: string;
	  digest: string;
		signature: { abi: number; params: string[]; results: string[] };
   	attributes: { attrs: string[] };
  }[];
};

type PackageSource = {
  // Rust project Cargo.toml as string
  cargoToml: string;
  // Rust project source code (src/lib.rs) as string
  rust: string;
};
```

## Verified Account Components Lookup

GET `/verified-account-components/[network]/[identifier]` Get the list of verified account components for a given network (`mtst` or `mdev`) and account identifier (Address without routing parameters eg. `mtst1ar2zjq0arpq5ysqqjqw8ws0jf5fygx84`).

When the contract has been previously verified with the API, it will return the list of verified components (in particular the Rust source code and the list of exported procedures).

This endpoint always returns the list of “standard” components this account implements, even if the contract hasn’t verified a custom component.

Standard accounts:

- basic-fungible-faucet
- basic-wallet
- network-fungible-faucet

Standard authentication components:

- auth-multisig-psm
- auth-multisig
- auth-no-auth
- auth-single-sig-acl
- auth-single-sig

When an error occurs, it will return an error message as text with a 500 status.

Response:

```
{
  components: Package[];
}
```

Example response for `/verified-account-components/mtst/mtst1ar2zjq0arpq5ysqqjqw8ws0jf5fygx84`:

```
{
  "components": [{
    "id": "auth-no-auth",
    "name": "auth-no-auth",
    "type": "authentication-component",
    "status": "compiled",
    "readOnly": true,
    "rust": "",
    "masm": "",
    "digest": "0xe9ee054ffeb3bd22bc4f0a4778960ec8e3571b0a0c8299bfed0cdb5d156686b7",
    "masp": "",
    "exports": [
      {
        "Procedure": {
          "path": "::no_auth::auth_no_auth",
          "digest": "0x00498108f0eae0e35deadd489892062338c3d55772635d0b133f0bdf2980bf64",
          "signature": {
            "abi": 0,
            "params": [],
            "results": []
          },
          "attributes": {
            "attrs": []
          }
        }
      }
    ],
    "dependencies": [],
    "createdAt": 0,
    "updatedAt": 0,
    "procedureExports": [EXPORTS_FILTERED_BY_PROCEDURE_TYPE]
  }, {
    "id": "832c7850-6a86-4b1e-bce0-78e446e6c289",
    "name": "bank-account",
    "type": "account",
    "status": "compiled",
    "readOnly": true,
    "rust": "RUST_SOURCE_CODE",
    "masm": "MASM_SOURCE_CODE",
    "digest": "0x7f7027a0e193520ff1fa2ef91280d01c9d52b8dfafb261660e0c5c4e20500ad7",
    "masp": "MASP_BINARY_BASE64",
    "exports": [
      {
        "Procedure": {
          "path": "::\"miden:bank-account/bank-account@0.1.0\"::\"get-balance\"",
          "digest": "0x637097e4a9c184959beaeff072881d7d3ae41da6abd6b2e631b7a1ae93febcc8",
          "signature": {
            "abi": 3,
            "params": [
              "Felt",
              "Felt",
              "Felt",
              "Felt"
            ],
            "results": [
              "Felt"
            ]
          },
          "attributes": {
            "attrs": []
          }
        }
      },
      ...REST_OF_EXPORTS
    ],
    "dependencies": [],
    "createdAt": 1771881268801,
    "updatedAt": 1771881268801,
    "procedureExports": [EXPORTS_FILTERED_BY_PROCEDURE_TYPE]
  }, ...REST_OF_COMPONENTS]
}
```

Implementation: [https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-account-components/[network]/[identifier]/route.ts](https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-account-components/%5Bnetwork%5D/%5Bidentifier%5D/route.ts)

## Verify Account Components

POST `/verified-account-components/[network]` Verify an account component from source, for a given network (`mtst` or `mdev`).

This endpoint verifies an account component is included in a given account deployed on-chain by re-compiling the provided component source code and verifying that every exported procedures digest is found in the account code.

Parameters:

```
{
  // Account ID eg. 0xd42901fd1841424000901c7741f24d
  accountId: string;
  // Address identifier eg. mtst1ar2zjq0arpq5ysqqjqw8ws0jf5fygx84
  identifier: string;
  // Package source (cargo.toml + src/lib.rs)
  packageSource: PackageSource;
}
```

The endpoint should return `{ “verified”: TRUE_OR_FALSE }` with a 200 status when the verification job is completed.

When an error occurs, it will return an error message as text with a 500 status.

Implementation: [https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-account-components/[network]/route.ts](https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-account-components/%5Bnetwork%5D/route.ts)

## Verified Notes Lookup

GET `/verified-notes/[network]/[id]` Get the verified note info for a given network (`mtst` or `mdev`) and id. (NoteId eg. `0xcc3f25ad4e48480fff9d9f2215566f2868cd5e82d9d0a59bbdd650fd2e10e85e`).

When the note has been previously verified with the API, it will return the note script info that was used to create the note (including full Rust source code with dependencies).

This endpoint can also detect the list of “standard” notes if the given note is a well-known note:

- p2id
- p2ide
- swap
- mint
- burn

When an error occurs, it will return an error message as text with a 500 status.

Response:

```
{
  noteScript: Package | null;
}
```

Example response for `/verified-notes/mtst/0xcc3f25ad4e48480fff9d9f2215566f2868cd5e82d9d0a59bbdd650fd2e10e85e`:

```
{
  "noteScript": {
    "id": "80ebd351-3c15-405d-94d0-3828fa908546",
    "name": "increment-note",
    "type": "note-script",
    "status": "compiled",
    "readOnly": true,
    "rust": "RUST_SOURCE_CODE",
    "masm": "MASM_SOURCE_CODE",
    "digest": "0xb32e40318f74563c4bfe004181a9522c929b84bed35c6cfde5cffa752bbf4a2b",
    "masp": "MASP_BINARY_BASE64",
    "exports": [],
    "dependencies": [
      {
        "id": "9a3822b4-5b9c-47ae-9882-d6d2327ec37f",
        "name": "counter-account",
        "type": "account",
        "digest": "0x731cad2d3773ba935f44856a31a47b7947d2ed4742980ad327593433bc5ddeb7",
        "rust": "DEPENDENCY_RUST_SOURCE_CODE"
      }
    ],
    "createdAt": 1774863118570,
    "updatedAt": 1774863118570,
    "procedureExports": []
  }
}
```

Implementation: [https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-notes/[network]/[id]/route.ts](https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-notes/[network]/[id]/route.ts)

## Verify Notes

POST `/verified-notes/[network]` Verify a note script from source, for a given network (`mtst` or `mdev`).

This endpoint verifies a note script for a given note by re-compiling the provided note script source code and verifying that it matches the on-chain note script.

Parameters:

```
{
  // Note ID eg. 0xcc3f25ad4e48480fff9d9f2215566f2868cd5e82d9d0a59bbdd650fd2e10e85e
  noteId: string;
  // Package source (cargo.toml + src/lib.rs)
  packageSource: PackageSource;
  // Optional dependencies list
  dependencies?: PackageSource[];
}
```

The endpoint should return `{ “verified”: TRUE_OR_FALSE }` with a 200 status when the verification job is completed.

When an error occurs, it will return an error message as text with a 500 status.

Implementation: [https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-notes/[network]/route.ts](https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/verified-notes/[network]/route.ts)

## Other

GET `/` Get API health and compiler version.

Example response:

```
{
  "timestamp": 1771958568526,
  "env": {
    "NODE_ENV": "production",
    "WEB_URL": "https://playground.miden.xyz",
    "PACKAGES_PATH": "/tmp"
  },
  "activeToolchainVersion": "0.14.0",
  "cargoMidenVersion": "0.8.1"
}
```

Implementation: [https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/route.ts](https://github.com/walnuthq/miden-playground/blob/main/apps/api/app/route.ts)