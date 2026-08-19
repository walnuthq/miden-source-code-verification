//! Generates the on-chain fixtures consumed by `packages/test-utils`.
//!
//! Deploys a counter-contract account to the network and calls `increment_count`
//! on it, then prints the resulting `fixtures.ts` export. The transaction is what
//! actually commits the freshly built account on-chain, so a single run covers
//! both halves of what used to be a manual process.
//!
//! The account is assembled from the compiled example crates — `counter-contract`
//! as the account component and `auth-component-no-auth` as the authentication
//! component — rather than from the standard components shipped by
//! `miden-standards`. That is what makes the api-compile verification tests
//! meaningful: they verify those very sources against this account.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use clap::Parser;
use miden_client::account::component::InitStorageData;
use miden_client::account::{Account, AccountBuilder, AccountComponent, AccountId, AccountType};
use miden_client::address::NetworkId;
use miden_client::builder::ClientBuilder;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client::store::TransactionFilter;
use miden_client::transaction::{
    TransactionId, TransactionRequestBuilder, TransactionScript, TransactionStatus,
};
use miden_client::utils::Deserializable;
use miden_client::vm::Package;
use miden_client::{Client, ClientRng};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::TryRng;

/// Directory under `examples/` holding every project this tool builds. Note that
/// it shares its name with the account-component project it contains.
const EXAMPLES_SUBDIR: &str = "counter-contract";

/// Example projects built for the deployment, in dependency order:
/// `counter-script` reads `../counter-contract/target/generated-wit/`, so the
/// account component has to be compiled before the transaction script.
const AUTH_COMPONENT: &str = "auth-component-no-auth";
const ACCOUNT_COMPONENT: &str = "counter-contract";
const TX_SCRIPT: &str = "counter-script";

/// Network id of a locally running node. `miden-client` reaches it through
/// [`Endpoint::localhost`], but [`NetworkId`] has no variant for it — it parses
/// as a custom network.
const LOCALHOST_NETWORK_ID: &str = "mlcl";

/// How long to wait for the deploying transaction to be committed on-chain.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);
const COMMIT_POLL_INTERVAL: Duration = Duration::from_secs(3);

const RPC_TIMEOUT_MS: u64 = 10_000;

// --- CLI ---

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// Network to deploy to: `mdev`, `mtst` or `mlcl`.
    #[arg(long, default_value = "mdev")]
    network_id: String,

    /// Root of the example projects. Defaults to this crate's sibling
    /// `apps/api-compile/examples` directory.
    #[arg(long)]
    examples_dir: Option<PathBuf>,

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
        other => bail!("unsupported network `{other}`; expected `mdev`, `mtst` or `mlcl`"),
    }
}

// --- Building the example projects ---

/// Compiles an example project with `cargo miden build --release` and reads back
/// the resulting package. Mirrors `apps/api-compile/src/lib/cargo-miden.ts`: the
/// artifact lands at `$MIDENC_TARGET_DIR/release/<project>.masp`.
///
/// `CARGO_TARGET_DIR` is deliberately left alone so each project builds into its
/// own `target/`, which is where `counter-script` expects to find the
/// `generated-wit/` directory produced by `counter-contract`.
fn build_package(examples_dir: &Path, project: &str, midenc_target_dir: &Path) -> Result<Package> {
    let project_dir = examples_dir.join(EXAMPLES_SUBDIR).join(project);
    let target_dir = midenc_target_dir.join(project);

    eprintln!("Building {project}…");
    let output = Command::new("cargo")
        .args(["miden", "build", "--release"])
        .current_dir(&project_dir)
        .env("MIDENC_TARGET_DIR", &target_dir)
        .output()
        .with_context(|| format!("failed to run `cargo miden build` for {project}"))?;

    if !output.status.success() {
        bail!(
            "`cargo miden build` failed for {project}:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let masp_path = target_dir.join("release").join(format!("{project}.masp"));
    let package_bytes = std::fs::read(&masp_path)
        .with_context(|| format!("failed to read package at {}", masp_path.display()))?;
    Package::read_from_bytes(&package_bytes)
        .map_err(|err| anyhow!("failed to deserialize {project} package: {err}"))
}

// --- Deploying ---

/// Builds a client backed by a throwaway store and keystore under `workdir`, so
/// every run deploys a genuinely new account and no state can leak in from a
/// previous one.
async fn connect(network_id: &NetworkId, workdir: &Path) -> Result<Client<FilesystemKeyStore>> {
    let rpc_client = Arc::new(GrpcClient::new(&endpoint(network_id)?, RPC_TIMEOUT_MS));
    let keystore = Arc::new(
        FilesystemKeyStore::new(workdir.join("keystore"))
            .context("failed to create the keystore")?,
    );

    ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(workdir.join("store.sqlite3"))
        .authenticator(keystore)
        .build()
        .await
        .context("failed to build the Miden client")
}

fn build_account(
    rng: &mut ClientRng,
    account_package: &Package,
    auth_package: &Package,
) -> Result<Account> {
    // Both components' storage is fully defaulted: the counter contract's only
    // slot is a `StorageMap`, which starts empty, and the no-auth component has
    // no storage at all.
    let account_component =
        AccountComponent::from_package(account_package, &InitStorageData::default())
            .context("failed to build the account component")?;
    let auth_component = AccountComponent::from_package(auth_package, &InitStorageData::default())
        .context("failed to build the authentication component")?;

    let mut init_seed = [0_u8; 32];
    rng.try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;

    AccountBuilder::new(init_seed)
        // Public, so the account's full state — and therefore its code — can be
        // read back from the node by the verification API.
        .account_type(AccountType::Public)
        .with_component(account_component)
        // There is no dedicated setter for the auth component: the builder picks
        // out the one component exporting an `@auth_script` procedure and moves
        // it to index 0 itself, so the insertion order here does not matter.
        .with_component(auth_component)
        .build()
        .context("failed to build the account")
}

/// Creates the account locally and then commits it on-chain by running
/// `increment_count` against it, returning its id once the transaction lands.
async fn deploy_account(
    client: &mut Client<FilesystemKeyStore>,
    account_package: &Package,
    auth_package: &Package,
    tx_script_package: &Package,
) -> Result<AccountId> {
    let account = build_account(client.rng(), account_package, auth_package)?;
    let account_id = account.id();
    client
        .add_account(&account, false)
        .await
        .context("failed to add the account to the client")?;
    eprintln!("Created account {}", account_id.to_hex());

    // `counter-script` is a `kind = "tx-script"` project, so it compiles to a
    // library rather than an executable. `from_package` handles both: for a
    // library it looks for the single export carrying the `@transaction_script`
    // attribute, which is what `#[tx_script] fn run` lowers to.
    let tx_script = TransactionScript::from_package(tx_script_package)
        .map_err(|err| anyhow!("failed to build the transaction script: {err}"))?;

    // The account authenticates itself with no-auth, so it can run its own
    // deploying transaction — no separate funded wallet is involved.
    let request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .context("failed to build the transaction request")?;
    let tx_id = client
        .submit_new_transaction(account_id, request)
        .await
        .context("failed to submit the increment_count transaction")?;
    eprintln!("Submitted increment_count transaction {}", tx_id.to_hex());

    wait_for_commitment(client, tx_id).await?;

    Ok(account_id)
}

/// Polls until the deploying transaction is committed. Returning earlier would
/// hand back an account id the network does not know about yet, which is exactly
/// what the fixtures must not contain.
async fn wait_for_commitment(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<()> {
    let deadline = std::time::Instant::now() + COMMIT_TIMEOUT;

    loop {
        client.sync_state().await.context("failed to sync state")?;

        let records = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await
            .context("failed to read back the transaction")?;
        let record = records.first().ok_or_else(|| {
            anyhow!(
                "transaction {} is not tracked by the client",
                tx_id.to_hex()
            )
        })?;

        match &record.status {
            TransactionStatus::Committed { block_number, .. } => {
                eprintln!("  committed in block {block_number}");
                return Ok(());
            }
            TransactionStatus::Discarded(cause) => {
                bail!("transaction {} was discarded: {cause:?}", tx_id.to_hex())
            }
            TransactionStatus::Pending => {}
        }

        if std::time::Instant::now() >= deadline {
            bail!(
                "transaction {} was still pending after {}s",
                tx_id.to_hex(),
                COMMIT_TIMEOUT.as_secs()
            );
        }
        tokio::time::sleep(COMMIT_POLL_INTERVAL).await;
    }
}

// --- Emitting the fixtures ---

/// Writes the `fixtures.ts` export for the deployed account. Only the id is
/// generated here; the account and note blobs alongside it in
/// `packages/test-utils/src/fixtures.ts` are captured separately.
fn emit_fixtures(account_id: AccountId, out: Option<PathBuf>) -> Result<()> {
    let fixtures = format!(
        "export const COUNTER_CONTRACT_ID_1 = \"{}\";\n",
        account_id.to_hex()
    );

    match out {
        Some(path) => {
            std::fs::write(&path, &fixtures)
                .with_context(|| format!("failed to write {}", path.display()))?;
            eprintln!("Wrote {}", path.display());
        }
        None => print!("{fixtures}"),
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let network_id = NetworkId::new(&args.network_id)
        .with_context(|| format!("`{}` is not a valid network id", args.network_id))?;
    let examples_dir = args.examples_dir.unwrap_or_else(default_examples_dir);

    // Everything transient — the midenc build artifacts, the store and the
    // keystore — lives under one temporary directory that goes away on exit.
    let workdir = tempfile::tempdir().context("failed to create a temporary working directory")?;
    let midenc_target_dir = workdir.path().join("midenc");

    let auth_package = build_package(&examples_dir, AUTH_COMPONENT, &midenc_target_dir)?;
    let account_package = build_package(&examples_dir, ACCOUNT_COMPONENT, &midenc_target_dir)?;
    let tx_script_package = build_package(&examples_dir, TX_SCRIPT, &midenc_target_dir)?;

    let mut client = connect(&network_id, workdir.path()).await?;
    let summary = client.sync_state().await.context("failed to sync state")?;
    eprintln!(
        "Connected to {network_id}. Latest block: {}",
        summary.block_num
    );

    let account_id = deploy_account(
        &mut client,
        &account_package,
        &auth_package,
        &tx_script_package,
    )
    .await?;

    emit_fixtures(account_id, args.out)
}
