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
//! against these accounts. The lone exception is the throwaway account that
//! emits the notes — see `note::build_note_factory`.

mod account;
mod build;
mod fixtures;
mod note;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use clap::Parser;
use miden_client::account::Account;
use miden_client::address::NetworkId;
use miden_client::auth::AuthSecretKey;
use miden_client::builder::ClientBuilder;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client::{Client, Word};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

use crate::build::Packages;
use crate::fixtures::Fixtures;

/// Network id of a locally running node. `miden-client` reaches it through
/// [`Endpoint::localhost`], but [`NetworkId`] has no variant for it — it parses
/// as a custom network.
const LOCALHOST_NETWORK_ID: &str = "mlcl";

const RPC_TIMEOUT_MS: u64 = 10_000;

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

/// Builds a client backed by a throwaway store and keystore under `workdir`, so
/// every run deploys genuinely new resources and no state can leak in from a
/// previous one. The keystore is handed back as well: the note factory has to
/// deposit its signing key in it.
async fn connect(
    network_id: &NetworkId,
    workdir: &Path,
) -> Result<(Client<FilesystemKeyStore>, Arc<FilesystemKeyStore>)> {
    let rpc_client = Arc::new(GrpcClient::new(&endpoint(network_id)?, RPC_TIMEOUT_MS));
    let keystore = Arc::new(
        FilesystemKeyStore::new(workdir.join("keystore"))
            .context("failed to create the keystore")?,
    );

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(workdir.join("store.sqlite3"))
        .authenticator(keystore.clone())
        .build()
        .await
        .context("failed to build the Miden client")?;

    Ok((client, keystore))
}

/// Builds the two accounts the tests never look up on-chain.
///
/// `count-reader` authenticates with no-auth like the counter contract does;
/// `basic-wallet` pairs with the RPO-Falcon512 component, whose public-key slot
/// is filled from a freshly drawn key. Neither is added to the client: nothing
/// is ever signed or submitted for them.
fn build_local_accounts(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
) -> Result<(Account, Account)> {
    let count_reader = account::assemble(
        client.rng(),
        &[&packages.count_reader, &packages.auth_no_auth],
        None,
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
    )?;
    eprintln!("Built basic-wallet account {}", basic_wallet.id().to_hex());

    Ok((count_reader, basic_wallet))
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

    let (mut client, keystore) = connect(&network_id, workdir.path()).await?;
    let summary = client.sync_state().await.context("failed to sync state")?;
    eprintln!(
        "Connected to {network_id}. Latest block: {}",
        summary.block_num
    );

    // Both counter contracts are assembled from the same components with the same
    // (empty) initial storage, so they share a code commitment — which is what
    // lets api-registry answer a lookup of one with a verification of the other.
    let counter_contracts = [
        account::deploy_counter_contract(&mut client, &packages).await?,
        account::deploy_counter_contract(&mut client, &packages).await?,
    ];

    let counter_notes =
        note::emit_counter_notes(&mut client, &keystore, &packages, counter_contracts[0].id())
            .await?;

    let (count_reader, basic_wallet) = build_local_accounts(&mut client, &packages)?;

    write_fixtures(
        &Fixtures {
            network_id: network_id.to_string(),
            counter_contracts,
            count_reader,
            basic_wallet,
            counter_notes,
        },
        args.out,
    )
}
