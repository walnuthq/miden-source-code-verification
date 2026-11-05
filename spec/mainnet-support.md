# Mainnet support (Miden Partner Mainnet)

Status: **implemented** on branch `feat/mainnet-support` (2026-11-04); see "What shipped". Written 2026-11-04, from the Miden Playground's Mainnet sandbox work (walnuthq/miden-playground, branch `feat/mainnet-sandbox`).

## Why

Miden opened **Partner Mainnet**, an invite-only mainnet that users join through Bread Wallet with an invite code. The Playground is adding a "Mainnet sandbox". There, users deploy accounts (in practice **network accounts**, see "Allowlist" below) and create notes on Mainnet. Today the Playground has to **skip source code verification on Mainnet**, because this service doesn't serve it:

- `packages/utils/src/networks.ts` has `// { label: "Mainnet", value: "mm" },` commented out.
- `miden-verifier` and `miden-import` reject any network ID other than `mtst`, `mdev` and `mlcl`.

Goal: verify account components and note scripts deployed on Mainnet, store them, serve them, and show them, exactly as for Testnet. Also: the Playground can drop its Mainnet guards, and the explorer can link to verified Mainnet sources.

## What shipped (2026-11-04)

Implemented on `feat/mainnet-support`. Decisions taken while implementing:

- **No Mainnet fixtures.** Deploying needs an invite code and real fees, so `generate-fixtures` still rejects `mm`, and the status-page probe (section 6) stays Testnet-only.
- **Mainnet is listed for everyone** in the network select, labelled plainly "Mainnet" (open question 3). The README explains that it's Partner Mainnet and will be reset.
- **The explorer is Midenscan.** `https://explorer.mainnet.miden.io` serves the same app as testnet.midenscan.com (`MIDEN_NETWORK: "mainnet"`), and `/account/<id>` resolves, so the existing link format applies (open question 2).

Changes, by section below:

1. `networks.ts` lists `{ label: "Mainnet", value: "mm" }`, and `network-select.tsx` gives it a `bg-primary` (Miden orange) dot. `DEFAULT_NETWORK` stays `mtst`. `RESOURCE_ID_PATTERN` and the address decoding needed no change.
2. `miden-verifier` and `miden-import` map `"mm"` to `Endpoint::mainnet()` (miden-client 0.17.5, no dependency change), and their error message lists `mm`. Per-network stores are created lazily, as for `mdev`, so nothing changed in the Dockerfile. A cold Mainnet import, store created from scratch, took 0.65 s.
3. **No change needed.** api-compile TS, the Cloudflare proxy and api-registry don't validate network IDs: they pass them through to the binaries, which reject unknown ones (404 on import, 400 on verify).
4. **No schema change.** The OpenAPI `networkId` descriptions now list `mm`.
5. `constants.ts` maps `mm` to `VITE_EXPLORER_MAINNET_URL ?? "https://explorer.mainnet.miden.io"`, set in `apps/web-viewer/Dockerfile`, the `cf:deploy` script and the README env table. The README has a paragraph on the networks served, with the Partner Mainnet reset caveat. The apps had no copy explaining networks.
6. Skipped (needs a fixture).

Tests, all read-only against Mainnet:

- **api-compile import:** the public USDCx faucet `0xe69e6ca6e39df1b10c1e5399399feb` imports on `/mm` by hex ID and by address. That address on `/mtst` gets the network-mismatch 404, and an unknown network (`mxx`) gets a 404.
- **api-compile verify:** the counter-contract against the Mainnet faucet returns 200 `verified: false`, a real Mainnet verify with no deploy. An unknown network gets a 400.
- **utils:** `networks.test.ts` is new. `resource-id.test.ts` now expects `mm` addresses to be named "Mainnet", and uses `mxx` as the network we don't serve.
- **web-viewer:** `constants.test.ts` (explorer URLs) is new, plus an `mm-0x…` zip-name case in `source-files.test.ts`.

Not done: api-registry `mm` cases (every registry path past validation needs a verified Mainnet resource), the status-page probe, a manual UI pass, and the open question 1 reset policy (`mm` records are kept as they are for now). The Playground's downstream changes can start once this deploys.

## Facts established in the Playground session (2026-11-04)

Checked against the live network with `@miden-sdk/miden-sdk` 0.17.8 (its Node entry). Re-check anything that matters before relying on it.

|                          | Mainnet                                                                                           | Testnet (for comparison)             |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Network ID / bech32 HRP  | **`mm`**                                                                                          | `mtst`                               |
| RPC                      | `https://rpc.mainnet.miden.io` (live, tip ≈ 595,000)                                              | `https://rpc.testnet.miden.io`       |
| Remote prover            | `https://tx-prover.mainnet.miden.io`                                                              | `https://tx-prover.testnet.miden.io` |
| Note transport           | `https://transport.mainnet.miden.io`                                                              | `https://transport.miden.io`         |
| Explorer                 | `https://explorer.mainnet.miden.io` (Midenscan, same app and `/<kind>/<id>` URLs as testnet)      | `https://testnet.midenscan.com`      |
| Genesis block commitment | `0x059cbb0195177b6e39f64f489912ef503cd8d3dffdf1a38b31f3cb504d1ebcef`                              | `0x280189b6…d7e567`                  |
| Fee asset (USDCx) faucet | `0xe69e6ca6e39df1b10c1e5399399feb`, `mm1arnfum9xuwwlrvgvrefejwvlavn3vk24_qr7qqq9wr6w`, 6 decimals | `0x4cbdcaffe75f0a317482224dae6436`   |
| `verificationBaseFee`    | 7                                                                                                 | 7                                    |

- **The Rust client already knows Mainnet.** In `miden-client` 0.17.0 through 0.17.5, `Endpoint::mainnet()` (`src/rpc/endpoint.rs`) is `https://rpc.mainnet.miden.io`. No new dependency is needed.
- **Reading needs no invite code.** The Node SDK synced, read block headers, and imported the public USDCx faucet account (`getOrImport`, storage readable) with no registration.
- **Allowlist.** On Mainnet, only accounts registered with an invite code (`register_account`, one code per account) and network accounts can be _created_. A fresh local wallet answers `is_account_allowed = false`. This gates account **creation** only; it doesn't affect reading accounts or notes, so it doesn't affect this service. It does mean most accounts verified on Mainnet will be **network accounts** (`AuthNetworkAccount`, already listed in both binaries' standard components) or Bread accounts.
- **This network is temporary.** Partner Mainnet will be **reset before public mainnet** ("you'll need to withdraw your funds before partner mainnet ends"). After the reset, account and note IDs verified on `mm` no longer exist on chain. Code and script roots, and the MASPs keyed by commitment, stay valid. See "Open questions".
- **Versions:** Miden's docs say "do not assume Mainnet and Testnet run the same version". Today a 0.17.8 client talks to both. The Playground has seen the testnet verifier fail when the local `miden-verifier` was older than the node. Expect the same on Mainnet: verify with the same pinned client and protocol as Testnet, and re-check whenever either network upgrades.

## What changes

### 1. Shared network list: `packages/utils/src/networks.ts`

- Uncomment and enable `{ label: "Mainnet", value: "mm" }`.
- `NetworkId` becomes `"mtst" | "mdev" | "mm"`, so TypeScript points at every exhaustive `Record<NetworkId, …>`. Known ones:
  - `packages/ui/src/components/network-select.tsx` `DOT_CLASS`: pick a distinct color.
  - `apps/web-viewer/src/lib/constants.ts` explorer URLs.
- Keep `DEFAULT_NETWORK = "mtst"`. Mainnet is opt-in through `?network=mm`.
- `resource-id.ts` decodes the bech32 HRP generically. Add a test that an `mm1…` address decodes to `networkId: "mm"`. Also check that `RESOURCE_ID_PATTERN`'s `[a-z]+1…` accepts the two-letter HRP.

### 2. api-compile binaries: `crates/miden-verifier/src/main.rs` and `crates/miden-import/src/main.rs`

- Add `"mm" => Endpoint::mainnet()` to the endpoint `match`, and update the error message (`expected mtst, mdev, mm or mlcl`).
- The per-network store and keystore directory (`network_dir`, named after the network ID) already isolates Mainnet. The client pins the first genesis it syncs with, so a shared store would break. Check that the image or runtime creates `mm/` like the others. If anything is pre-created or warmed per network in the Dockerfile or startup, add `mm`.
- Both binaries check that a bech32 resource's network matches `--network-id`. Mainnet needs nothing extra there.
- First run on Mainnet: confirm the client syncs from genesis in acceptable time, or whatever the binary does on first use. Mainnet's chain is younger than Testnet's (≈595k vs ≈830k blocks on 2026-11-04).

### 3. api-compile TS and Cloudflare proxy

- `src/lib/miden-verifier.ts` and `src/lib/miden-import.ts` pass `networkId` through. Check whether they or the routes (`routes/verify.ts`, `routes/import.ts`, `apps/api-compile-cloudflare/src/server.ts` `/:networkId/import/:resourceId`) validate it against a list, and add `mm`.

### 4. api-registry

- The routes are already `/:networkId/…`, and records are keyed on `(network_id, code)` and `(network_id, script)` (migration `20260804091247_bouncy_shocker`). **No schema change**: `mm` fits `varchar(16)`.
- Check for an allowlist of network IDs in the routes or `src/lib/*` (`verify-account-component.ts`, `verify-note.ts`, `import-resource.ts`), and add `mm`. An unknown network should still be rejected cleanly.
- `packages` routes say `networkId` doesn't affect the MASP result. Keep it that way.
- Update the OpenAPI descriptions that list example networks (`` `mtst`, `mdev` ``).

### 5. web-verifier and web-viewer

- The network select and the `?network=` param come from the shared list, so they pick up Mainnet.
- web-viewer explorer link: add `mm: import.meta.env.VITE_EXPLORER_MAINNET_URL ?? "https://explorer.mainnet.miden.io"` in `src/lib/constants.ts`.
  - Add `VITE_EXPLORER_MAINNET_URL` to `apps/web-viewer/Dockerfile` (ARG and ENV) and to the `cf:deploy` script in `apps/web-viewer-cloudflare/package.json`.
  - **Verify the URL format** (`/account/<id>`, `/note/<id>`, whatever `constants.ts` builds) against the real Mainnet explorer. If it doesn't match, leave `mm` out of the map; links are already omitted for networks without one.
- `source-files.ts` builds zip names like `mtst-0x…-name.zip`, so `mm-0x…` works as is.
- UI copy: anywhere that says "testnet" or explains networks should mention Mainnet, and that it's invite-only and will be reset.

### 6. status-page (optional, recommended)

- `scripts/probe.ts` probes Testnet only (`NETWORK_ID = "mtst"`). Once a Mainnet fixture exists (see Testing), add a Mainnet probe for the registry and import paths, so a Mainnet RPC outage or version drift shows up.

## Testing

- **A Mainnet fixture is needed.** Testnet fixtures are the counter contract and counter note (`COUNTER_CONTRACT_ID_1`, `COUNTER_NOTE_ID_1` in `packages/test-utils`). The Playground's Mainnet QA will deploy a **network counter** (counter-contract example `counter-account` with `AuthNetworkAccount`) and send it an `increment-note` network note from Bread. Use those IDs as the Mainnet fixtures; the Playground session can provide them once its QA runs.
  - **Creating your own account on Mainnet needs an invite code**, apart from network accounts. Deploying costs real USDCx: the network account needs ~0.001 USDCx and a note sender pays fees and a sponsorship.
- Add `mm` cases next to the `mtst` ones: api-compile `__tests__/import.test.ts` and `verify.test.ts`, api-registry `verified-accounts`, `verified-notes` and `verify-account-component` tests, and web-viewer `source-files.test.ts`.
- Per this repo's CLAUDE.md, the suites hit the docker compose stack. Rebuild it (`docker compose up -d --build`) before running them.
- Manual check: verify the network counter's component and the note script through web-verifier with `?network=mm`, then view them in web-viewer, including the explorer link and the MASP download.

## Downstream: Miden Playground (after this ships)

Done in walnuthq/miden-playground, not here. Listed so the two changes line up:

- Remove the `networkId !== "mm"` verification guards:
  - `apps/web/hooks/use-accounts.ts` (deploy-time `verifyAccountComponentsFromPackageIds`)
  - `apps/web/hooks/use-notes.ts` (`verifyNoteFromPackageId`)
  - `apps/web/components/account/account-components.tsx` and `components/note/note-information-table.tsx` (verify buttons)
- Add `"mm"` to the `["mtst", "mdev"].includes(networkId)` query guards in `components/account/index.tsx` and `components/note/index.tsx`.
- The Playground API's CORS list already includes `https://explorer.mainnet.miden.io`.
- Update the Playground's CLAUDE.md "Mainnet sandbox" section, which says verification is skipped.

## Open questions

1. **The Partner Mainnet reset.** After the reset, should `mm` records be deleted, kept but marked stale, or kept as they are? Code roots stay meaningful, but resource-ID lookups (`/verified-accounts/{accountId}`) will 404 at the import step. Agree on this with the Playground (its saved Mainnet projects are invalidated by the same reset).
2. ~~**Explorer URL and format** for Mainnet (see section 5).~~ Resolved: Midenscan, same format as testnet.
3. ~~**Whether to show Mainnet in the network select for everyone,** with a "Partner Mainnet (invite-only)" label, or only with `?network=mm`.~~ Resolved: listed for everyone as "Mainnet".
