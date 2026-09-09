//! Assembling the fixture accounts out of the compiled example packages, and
//! committing on-chain the ones the tests read back from the network.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use miden_client::account::component::{
    AccountComponentMetadata, InitStorageData, SchemaType, WordValue,
};
use miden_client::account::{
    Account, AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountComponent, AccountId,
    AccountType,
};
use miden_client::keystore::FilesystemKeyStore;
use miden_client::note::Note;
use miden_client::store::TransactionFilter;
use miden_client::transaction::{TransactionId, TransactionRequestBuilder, TransactionStatus};
use miden_client::vm::Package;
use miden_client::{Client, ClientRng, Word};
use rand::TryRng;

use crate::fee::FeeContext;

/// How long to wait for a deploying transaction to be committed on-chain.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);
const COMMIT_POLL_INTERVAL: Duration = Duration::from_secs(3);

// --- Assembling ---

/// Builds the [`InitStorageData`] a component's storage schema asks for.
///
/// Walks the schema the way `miden-client-cli`'s `new-account` command does,
/// except that it fills the values in itself instead of prompting for them:
/// schema defaults win wherever they exist, `public_key` covers the
/// `miden::standards::auth::pub_key` slot that `auth-component-rpo-falcon512`
/// declares, and anything else starts at zero — which in `examples/` only ever
/// means `count-reader`'s counter.
fn init_storage_data(package: &Package, public_key: Option<Word>) -> Result<InitStorageData> {
    let metadata = AccountComponentMetadata::try_from(package)
        .with_context(|| format!("{} carries no account component metadata", package.name))?;

    let mut values = BTreeMap::new();
    for (name, requirement) in metadata.schema_requirements() {
        let value = match (&requirement.default_value, public_key) {
            (Some(default), _) => WordValue::Atomic(default.clone()),
            (None, Some(public_key)) if requirement.r#type == SchemaType::pub_key() => {
                WordValue::FullyTyped(public_key)
            }
            (None, _) => WordValue::Atomic("0".to_string()),
        };
        values.insert(name, value);
    }

    // No component under `examples/` wants preset map entries: `counter-contract`'s
    // storage map starts empty.
    InitStorageData::new(values, BTreeMap::new())
        .with_context(|| format!("failed to build init storage data for {}", package.name))
}

fn account_component(package: &Package, public_key: Option<Word>) -> Result<AccountComponent> {
    let init_storage_data = init_storage_data(package, public_key)?;
    AccountComponent::from_package(package, &init_storage_data)
        .with_context(|| format!("failed to build the {} component", package.name))
}

/// Assembles an account from compiled example packages.
///
/// The components come from `apps/api-compile/examples` rather than from the
/// standard ones `miden-standards` ships. That is what makes the api-compile
/// verification tests meaningful: they verify those very sources against these
/// accounts.
///
/// `standard_components` are added on top. Only the accounts that transact need
/// any — see [`deploy_counter_contract`] — and the verifier is unbothered by
/// them: it checks that every procedure a package exports is present in the
/// account's code, not that the account holds nothing else.
pub fn assemble(
    rng: &mut ClientRng,
    packages: &[&Package],
    public_key: Option<Word>,
    standard_components: Vec<AccountComponent>,
) -> Result<Account> {
    let mut init_seed = [0_u8; 32];
    rng.try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;

    let mut builder = AccountBuilder::new(init_seed)
        // Public, so the account's full state — and therefore its code — can be
        // read back from the node by the verification API.
        .account_type(AccountType::Public);

    // There is no dedicated setter for the auth component: the builder picks out
    // the one component exporting an `@auth_script` procedure and moves it to
    // index 0 itself, so the order here does not matter.
    for package in packages {
        builder = builder.with_component(account_component(package, public_key)?);
    }
    for component in standard_components {
        builder = builder.with_component(component);
    }

    // `build_with_schema_commitment` rather than plain `build`: it is what the
    // miden CLI does by default, and the storage slot it adds is what lets
    // tooling recover the account's storage layout.
    builder
        .build_with_schema_commitment()
        .context("failed to build the account")
}

// --- Deploying ---

/// Commits an assembled counter-contract account on-chain and returns the account
/// the node ends up holding.
///
/// `increment` is the counter-note the account consumes, whose script runs
/// `increment_count`. The increment does not ride on a transaction script,
/// because on a fee-charging chain the transaction script slot is taken: the
/// account's auth component is `examples/counter-contract/auth-component-no-auth`,
/// which cannot create a fee note (midenc links neither `miden::standards::fee`
/// nor a Rust binding for the kernel's fee procedures), so the only thing left
/// that can is the send-notes script the client derives from `own_output_notes` —
/// and `TransactionRequestBuilder` rejects that together with a custom script.
/// A note script runs independently of the transaction script, so putting the
/// increment in a note leaves the script free to carry the fee.
///
/// `funding` and `fees` are `None` on a chain that charges no fee, where the
/// storage change from `increment_count` is by itself enough to move the account
/// commitment — which is the only thing that makes no-auth bump the nonce, and a
/// transaction leaving the state untouched would leave the account at nonce 0,
/// that is, undeployed.
pub async fn deploy_counter_contract(
    client: &mut Client<FilesystemKeyStore>,
    account_id: AccountId,
    increment: Note,
    funding: Option<Note>,
    fees: Option<&FeeContext>,
) -> Result<Account> {
    let fee_note = fees
        .map(|fees| fees.fee_note(account_id, client.rng()))
        .transpose()?;

    let request = TransactionRequestBuilder::new()
        // The funding note is consumed first so its assets are in the vault by
        // the time the fee note is funded out of it.
        .input_notes(funding.into_iter().chain([increment]).map(|note| (note, None)))
        .own_output_notes(fee_note)
        .build()
        .context("failed to build the transaction request")?;
    let tx_id = client
        .submit_new_transaction(account_id, request)
        .await
        .context("failed to submit the increment_count transaction")?;
    eprintln!("  submitted increment_count transaction {}", tx_id.to_hex());

    wait_for_commitment(client, tx_id).await?;

    // Read the account back instead of returning the one built above: the
    // transaction moved it to nonce 1 with a counter of 1, and the fixture
    // should carry the state the node actually serves.
    let record = client
        .get_account(account_id)
        .await
        .context("failed to read back the deployed account")?
        .ok_or_else(|| {
            anyhow!(
                "account {} is not tracked by the client",
                account_id.to_hex()
            )
        })?;
    Account::try_from(record)
        .map_err(|err: Infallible| anyhow!("account is missing full account data: {err}"))
}

/// Polls until a transaction is committed. Returning earlier would hand back a
/// resource id the network does not know about yet, which is exactly what the
/// fixtures must not contain.
pub async fn wait_for_commitment(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<()> {
    let deadline = Instant::now() + COMMIT_TIMEOUT;

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

        if Instant::now() >= deadline {
            bail!(
                "transaction {} was still pending after {}s",
                tx_id.to_hex(),
                COMMIT_TIMEOUT.as_secs()
            );
        }
        tokio::time::sleep(COMMIT_POLL_INTERVAL).await;
    }
}
