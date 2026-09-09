//! Generates the on-chain fixtures consumed by `packages/test-utils`.
//!
//! One run produces the whole of `packages/test-utils/src/fixtures.ts`: it
//! compiles every example project the fixtures are built from, deploys the
//! resources the tests read back from the network, assembles the ones they only
//! ever hand over as a local blob, and prints the file.
//!
//! What ends up on-chain is only what has to be. `/import`, the on-chain half of
//! `/verify` and both of api-registry's id-keyed lookups resolve an account's
//! code root or a note's script root from the node, so the two counter-contract
//! accounts and the two counter-notes are deployed. `count-reader` and
//! `basic-wallet` are only ever passed to the verifier alongside their
//! serialized `resource`, so they are built locally and never submitted.
//!
//! The accounts are assembled from the compiled example crates rather than from
//! the standard components `miden-standards` ships. That is what makes the
//! api-compile verification tests meaningful: they verify those very sources
//! against these accounts. The lone exception is the throwaway accounts that
//! emit the notes and pay for everything — see `note::create_factory` and
//! `fee::fund`.
//!
//! On a chain that charges a transaction fee every account that transacts also
//! carries the standard `BasicWallet`, and is funded from the public faucet
//! before it does. `fee` explains why that is unavoidable.

mod account;
mod build;
mod fee;
mod fixtures;
mod note;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use clap::Parser;
use miden_client::account::component::BasicWallet;
use miden_client::account::{Account, AccountComponent};
use miden_client::address::NetworkId;
use miden_client::auth::AuthSecretKey;
use miden_client::builder::ClientBuilder;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client::{Client, Word};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

use crate::build::Packages;
use crate::fee::FeeContext;
use crate::fixtures::Fixtures;

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

    /// Keep the compiled `.masp` packages here instead of in the temporary
    /// working directory, so they outlive the run — which is what makes it
    /// possible to re-check the generated fixtures with `miden-verifier`.
    #[arg(long)]
    artifacts_dir: Option<PathBuf>,

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

/// Builds a client backed by a throwaway store and keystore under `workdir`, so
/// every run deploys genuinely new resources and no state can leak in from a
/// previous one. Nothing is ever signed here — every account deployed by this
/// tool authenticates without a signature — but the client still wants an
/// authenticator, so the keystore is built and handed to it all the same.
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
/// On a fee-charging chain that is `BasicWallet`, twice over: consuming the P2ID
/// note that funds the account calls its `receive_asset`, and the send-notes
/// script the client derives for the fee note calls its `move_asset_to_note`.
/// On a fee-free chain nothing is added, and the fixtures stay exactly what they
/// were before fees existed.
fn transacting_components(fees: Option<&FeeContext>) -> Vec<AccountComponent> {
    match fees {
        Some(_) => vec![BasicWallet.into()],
        None => vec![],
    }
}

/// Builds the two accounts the tests never look up on-chain.
///
/// `count-reader` authenticates with no-auth like the counter contract does;
/// `basic-wallet` pairs with the RPO-Falcon512 component, whose public-key slot
/// is filled from a freshly drawn key. Neither is added to the client: nothing
/// is ever signed or submitted for them, so neither needs to be able to pay a
/// fee either.
fn build_local_accounts(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
) -> Result<(Account, Account)> {
    let count_reader = account::assemble(
        client.rng(),
        &[&packages.count_reader, &packages.auth_no_auth],
        None,
        vec![],
    )?;
    eprintln!("Built count-reader account {}", count_reader.id().to_hex());

    let public_key = Word::from(
        AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng())
            .public_key()
            .to_commitment(),
    );
    let basic_wallet = account::assemble(
        client.rng(),
        &[&packages.basic_wallet, &packages.auth_rpo_falcon512],
        Some(public_key),
        vec![],
    )?;
    eprintln!("Built basic-wallet account {}", basic_wallet.id().to_hex());

    Ok((count_reader, basic_wallet))
}

/// Assembles the two counter-contract accounts and registers them with the
/// client, without submitting anything.
///
/// They exist before any transaction does because the notes that deploy them are
/// tagged for them, and the note factory has to emit those notes first.
///
/// Both are assembled from the same components with the same (empty) initial
/// storage, so they share a code commitment — which is what lets api-registry
/// answer a lookup of one with a verification of the other.
async fn assemble_counter_contracts(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
    fees: Option<&FeeContext>,
) -> Result<[Account; 2]> {
    let mut accounts = Vec::with_capacity(2);

    for _ in 0..2 {
        let account = account::assemble(
            client.rng(),
            &[&packages.counter_contract, &packages.auth_no_auth],
            None,
            transacting_components(fees),
        )?;
        client
            .add_account(&account, false)
            .await
            .context("failed to add the account to the client")?;
        eprintln!("Created counter-contract account {}", account.id().to_hex());
        accounts.push(account);
    }

    Ok(accounts
        .try_into()
        .unwrap_or_else(|_| unreachable!("the loop pushes exactly two accounts")))
}

fn write_fixtures(fixtures: &Fixtures, out: Option<PathBuf>) -> Result<()> {
    let rendered = fixtures.render();

    match out {
        Some(path) => {
            std::fs::write(&path, &rendered)
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

    // Everything transient — the store, the keystore and, unless the caller asked
    // for them elsewhere, the midenc build artifacts — lives under one temporary
    // directory that goes away on exit.
    let workdir = tempfile::tempdir().context("failed to create a temporary working directory")?;
    let midenc_target_dir = args
        .artifacts_dir
        .unwrap_or_else(|| workdir.path().join("midenc"));

    let packages = Packages::build(&examples_dir, &midenc_target_dir)?;

    let mut client = connect(&network_id, workdir.path()).await?;
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

    let counter_contracts = assemble_counter_contracts(&mut client, &packages, fees.as_ref()).await?;
    let counter_ids = [counter_contracts[0].id(), counter_contracts[1].id()];
    let factory = note::create_factory(&mut client).await?;

    // Everything that transacts is paid up front, in one go, so the faucet is
    // asked for tokens once per run.
    let mut funding = match &fees {
        Some(fees) => {
            let url = match args.faucet_url {
                Some(url) => url,
                None => faucet_url(&network_id)?,
            };
            fee::fund(
                &mut client,
                fees,
                &network_id,
                &url,
                &[counter_ids[0], counter_ids[1], factory],
            )
            .await?
        }
        None => BTreeMap::new(),
    };

    let notes = note::emit_notes(
        &mut client,
        &packages,
        factory,
        counter_ids,
        funding.remove(&factory),
    )
    .await?;

    // Deploying reads each account back, so the fixture carries the state the
    // node actually serves rather than the one assembled above.
    let mut deployed = Vec::with_capacity(2);
    for (account_id, increment) in counter_ids.into_iter().zip(notes.increments) {
        deployed.push(
            account::deploy_counter_contract(
                &mut client,
                account_id,
                increment,
                funding.remove(&account_id),
                fees.as_ref(),
            )
            .await?,
        );
    }
    let counter_contracts = deployed
        .try_into()
        .unwrap_or_else(|_| unreachable!("the loop pushes exactly two accounts"));

    let (count_reader, basic_wallet) = build_local_accounts(&mut client, &packages)?;

    write_fixtures(
        &Fixtures {
            network_id: network_id.to_string(),
            counter_contracts,
            count_reader,
            basic_wallet,
            counter_notes: notes.fixtures,
        },
        args.out,
    )
}
