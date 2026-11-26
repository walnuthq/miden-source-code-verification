//! Generates the on-chain fixtures consumed by `packages/test-utils`.
//!
//! One run produces the whole of `packages/test-utils/src/fixtures.ts`: it
//! assembles the example projects the fixtures are built from, deploys them,
//! and prints the file.
//!
//! What ends up on-chain is only what has to be. `/import`, the on-chain half of
//! `/verify` and both of api-registry's id-keyed lookups resolve an account's
//! code root or a note's script root from the node, so one counter-contract
//! account and one counter-note are deployed: see `deploy`.
//!
//! The account is assembled from the example's package rather than from the
//! standard components `miden-standards` ships. That is what makes the
//! api-compile verification tests meaningful: they verify those very sources
//! against it. The exceptions are the throwaway accounts that emit the notes
//! and pay for everything — see `note::create_factory` and `fee::fund`.
//!
//! On a chain that charges a transaction fee every account that transacts also
//! carries the standard `BasicWallet`, and is funded from the public faucet
//! before it does. `fee` explains why that is unavoidable.

mod deploy;
mod fee;
mod fixtures;
mod note;
mod tx;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use clap::Parser;
use miden_client::Client;
use miden_client::account::AccountComponent;
use miden_client::account::component::BasicWallet;
use miden_client::address::NetworkId;
use miden_client::builder::ClientBuilder;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

use crate::fee::FeeContext;

/// Network id of a locally running node. `miden-client` reaches it through
/// [`Endpoint::localhost`], but [`NetworkId`] has no variant for it — it parses
/// as a custom network.
const LOCALHOST_NETWORK_ID: &str = "mlcl";

const RPC_TIMEOUT_MS: u64 = 10_000;

const DEVNET_FAUCET_URL: &str = "https://faucet-api.devnet.miden.io";
const TESTNET_FAUCET_URL: &str = "https://faucet-api.testnet.miden.io";

// --- CLI ---

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// Network to deploy to: `mtst`, `mdev` or `mlcl`. Defaults to testnet,
    /// which is the network every fixture consumer asserts against.
    #[arg(long, default_value = "mtst")]
    network_id: String,

    /// Root of the example projects. Defaults to this crate's sibling
    /// `apps/api-compile/examples` directory.
    #[arg(long)]
    examples_dir: Option<PathBuf>,

    /// Faucet to draw the native fee asset from. Only used on a chain that
    /// charges a transaction fee; defaults to the public faucet of the network
    /// being deployed to.
    #[arg(long)]
    faucet_url: Option<String>,

    /// Write the generated fixtures here instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

fn default_examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

/// Resolves the node to talk to. Mainnet and unknown networks are rejected
/// rather than quietly redirected: the accounts deployed here are throwaway
/// fixtures that belong on a test network only.
fn endpoint(network_id: &NetworkId) -> Result<Endpoint> {
    match network_id {
        NetworkId::Devnet => Ok(Endpoint::devnet()),
        NetworkId::Testnet => Ok(Endpoint::testnet()),
        _ if network_id.as_str() == LOCALHOST_NETWORK_ID => Ok(Endpoint::localhost()),
        other => bail!("unsupported network `{other}`; expected `mtst`, `mdev` or `mlcl`"),
    }
}

/// Resolves the faucet to draw the fee asset from. A local node has no public
/// faucet, so a fee-charging one has to be told where to look.
fn faucet_url(network_id: &NetworkId) -> Result<String> {
    match network_id {
        NetworkId::Devnet => Ok(DEVNET_FAUCET_URL.to_string()),
        NetworkId::Testnet => Ok(TESTNET_FAUCET_URL.to_string()),
        other => bail!(
            "`{other}` charges a transaction fee and has no public faucet to draw it from; pass \
             --faucet-url"
        ),
    }
}

/// `--faucet-url` if given, else the network's public faucet.
fn faucet_url_or_default(given: Option<String>, network_id: &NetworkId) -> Result<String> {
    match given {
        Some(url) => Ok(url),
        None => faucet_url(network_id),
    }
}

/// Builds a client backed by a throwaway store and keystore under `workdir`, so
/// every run deploys genuinely new resources and no state can leak in from a
/// previous one. Nothing is ever signed here — every account deployed by this
/// tool authenticates without a signature — and the client would build without
/// an authenticator. The keystore is handed to it all the same, so the client
/// has the type `miden-import` and `miden-verifier` use.
async fn connect(network_id: &NetworkId, workdir: &Path) -> Result<Client<FilesystemKeyStore>> {
    let rpc_client = Arc::new(GrpcClient::new(&endpoint(network_id)?, RPC_TIMEOUT_MS));
    let keystore = Arc::new(
        FilesystemKeyStore::new(workdir.join("keystore"))
            .context("failed to create the keystore")?,
    );

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(workdir.join("store.sqlite3"))
        .authenticator(keystore)
        .build()
        .await
        .context("failed to build the Miden client")?;

    Ok(client)
}

/// The standard components an account has to carry to transact on this chain.
///
/// On a fee-charging chain that is `BasicWallet`: consuming the P2ID note that
/// funds the account calls its `receive_asset`. On a fee-free chain nothing is
/// added.
fn transacting_components(fees: Option<&FeeContext>) -> Vec<AccountComponent> {
    match fees {
        Some(_) => vec![BasicWallet.into()],
        None => vec![],
    }
}

fn write_fixtures(rendered: &str, out: Option<PathBuf>) -> Result<()> {
    match out {
        Some(path) => {
            std::fs::write(&path, rendered)
                .with_context(|| format!("failed to write {}", path.display()))?;
            eprintln!("Wrote {}", path.display());
        }
        None => print!("{rendered}"),
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let network_id = NetworkId::new(&args.network_id)
        .with_context(|| format!("`{}` is not a valid network id", args.network_id))?;
    let examples_dir = args.examples_dir.unwrap_or_else(default_examples_dir);

    let packages = deploy::Packages::build(&examples_dir)?;

    // The store and the keystore live under one temporary directory that goes
    // away on exit.
    let workdir = tempfile::tempdir().context("failed to create a temporary working directory")?;
    let (mut client, fees) = connect_and_detect_fees(&network_id, workdir.path()).await?;
    let url = match &fees {
        Some(_) => Some(faucet_url_or_default(args.faucet_url, &network_id)?),
        None => None,
    };
    let fees = fees.as_ref().zip(url.as_deref());

    let fixtures = deploy::deploy(&mut client, &packages, &network_id, fees).await?;
    write_fixtures(&fixtures.render(), args.out)
}

/// Connects to the network and reads what it charges.
async fn connect_and_detect_fees(
    network_id: &NetworkId,
    workdir: &Path,
) -> Result<(Client<FilesystemKeyStore>, Option<FeeContext>)> {
    let mut client = connect(network_id, workdir).await?;
    let summary = client.sync_state().await.context("failed to sync state")?;
    eprintln!(
        "Connected to {network_id}. Latest block: {}",
        summary.block_num
    );

    let fees = FeeContext::detect(&client).await?;
    match &fees {
        Some(fees) => eprintln!(
            "Chain charges fees; every transaction pays {}",
            fees.fee_note_amount()
        ),
        None => eprintln!("Chain charges no fees; nothing needs funding"),
    }
    Ok((client, fees))
}
