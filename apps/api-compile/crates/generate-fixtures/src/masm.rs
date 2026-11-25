//! The MASM fixtures: one account built from `examples/masm/counter-contract`
//! and one note built from `examples/masm/counter-note`, both assembled with
//! `miden-assemble`'s library rather than through cargo.
//!
//! They sit next to the Rust fixtures and don't replace them, so this mode
//! writes a file of its own (`packages/test-utils/src/masm-fixtures.ts`) and
//! leaves `fixtures.ts` as it is.
//!
//! The account carries the MASM counter component plus the standard `NoAuth`
//! and, on a fee-charging chain, the standard `BasicWallet`. The standard
//! `NoAuth` creates the fee note itself, so the deploying transaction needs no
//! script: it consumes its funding note and an increment note, whose script
//! calls `increment_count` on the account. The fixture note is a second note of
//! the same script that nothing consumes.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use base64::prelude::*;
use miden_client::Client;
use miden_client::account::component::{AccountComponentMetadata, NoAuth};
use miden_client::account::{
    Account, AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
};
use miden_client::address::NetworkId;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::note::{Note, NoteScript};
use miden_client::transaction::TransactionRequestBuilder;
use miden_client::utils::Serializable;
use miden_client::vm::Package;
use rand::TryRng;

use crate::account::wait_for_commitment;
use crate::fee::{self, FeeContext};
use crate::fixtures::entry;
use crate::note::{build_note, create_factory};
use crate::transacting_components;

/// The value slot `counter_contract.masm` keeps its count in. A MASM package
/// has no storage schema, so the slot is declared here.
const COUNT_SLOT: &str = "counter_contract::count";

/// The two packages, assembled from `<examples>/masm`.
pub struct Packages {
    pub counter_contract: Package,
    pub counter_note: Package,
}

impl Packages {
    /// Assembles both, with `<examples>/masm` as the project root: the note's
    /// manifest depends on `../counter-contract`. `miden-assemble` names the
    /// sources relative to the root and reads them from the working directory,
    /// so the process moves into the root for the build and back out after it.
    pub fn build(examples_dir: &Path) -> Result<Self> {
        let root = examples_dir
            .join("masm")
            .canonicalize()
            .context("failed to read the MASM examples directory")?;
        let cwd = std::env::current_dir().context("failed to read the working directory")?;
        std::env::set_current_dir(&root)
            .with_context(|| format!("failed to enter {}", root.display()))?;
        let packages = Self::build_in(&root);
        std::env::set_current_dir(&cwd)
            .with_context(|| format!("failed to return to {}", cwd.display()))?;
        packages
    }

    /// [`Self::build`], run from `root`.
    fn build_in(root: &Path) -> Result<Self> {
        let build = |project: &str| -> Result<Package> {
            eprintln!("Assembling masm/{project}…");
            let manifest = root.join(project).join("miden-project.toml");
            let package = miden_assemble::build(&manifest, root, false)
                .map_err(|report| anyhow!("failed to assemble masm/{project}:\n{report:?}"))?;
            Ok(Package::clone(&package))
        };

        Ok(Self {
            counter_contract: build("counter-contract")?,
            counter_note: build("counter-note")?,
        })
    }
}

/// What the generated file is written from.
pub struct Fixtures {
    pub network_id: String,
    pub counter_contract: Account,
    pub counter_note: Note,
}

/// Deploys the MASM fixtures and returns them. `fees` is what the chain
/// charges and the faucet to draw it from, or `None` on a fee-free chain.
pub async fn deploy(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
    network_id: &NetworkId,
    fees: Option<(&FeeContext, &str)>,
) -> Result<Fixtures> {
    let account = assemble_counter_contract(client, packages, fees.map(|(fees, _)| fees)).await?;
    let account_id = account.id();
    let factory = create_factory(client).await?;

    let mut funding = match fees {
        Some((fees, url)) => {
            fee::fund(client, fees, network_id, url, &[account_id, factory]).await?
        }
        None => BTreeMap::new(),
    };

    let script = NoteScript::from_package(&packages.counter_note)
        .map_err(|err| anyhow!("failed to build the counter-note script: {err}"))?;
    let counter_note = build_note(client.rng(), &script, factory, account_id)?;
    eprintln!("Created MASM counter-note {}", counter_note.id().to_hex());
    let increment = build_note(client.rng(), &script, factory, account_id)?;
    eprintln!("Created MASM increment note {}", increment.id().to_hex());

    let request = TransactionRequestBuilder::new()
        .input_notes(funding.remove(&factory).map(|note| (note, None)))
        .own_output_notes([counter_note.clone(), increment.clone()])
        .build()
        .context("failed to build the note-creating transaction request")?;
    let tx_id = client
        .submit_new_transaction(factory, request)
        .await
        .context("failed to submit the note-creating transaction")?;
    eprintln!("  submitted note-creating transaction {}", tx_id.to_hex());
    wait_for_commitment(client, tx_id).await?;

    // The funding note first, so the vault holds the fee by the time `NoAuth`
    // draws on it.
    let request = TransactionRequestBuilder::new()
        .input_notes(
            funding
                .remove(&account_id)
                .into_iter()
                .chain([increment])
                .map(|note| (note, None)),
        )
        .build()
        .context("failed to build the transaction request")?;
    let tx_id = client
        .submit_new_transaction(account_id, request)
        .await
        .context("failed to submit the increment_count transaction")?;
    eprintln!("  submitted increment_count transaction {}", tx_id.to_hex());
    wait_for_commitment(client, tx_id).await?;

    let counter_contract = client
        .get_account(account_id)
        .await
        .context("failed to read back the deployed account")?
        .ok_or_else(|| {
            anyhow!(
                "account {} is not tracked by the client",
                account_id.to_hex()
            )
        })?;
    let count = counter_contract
        .storage()
        .get_item(&count_slot()?)
        .context("the MASM counter has no count slot")?;
    if count[0].as_canonical_u64() != 1 {
        bail!(
            "the MASM counter {} counts {} after one increment",
            account_id.to_hex(),
            count[0].as_canonical_u64()
        );
    }

    Ok(Fixtures {
        network_id: network_id.to_string(),
        counter_contract,
        counter_note,
    })
}

fn count_slot() -> Result<StorageSlotName> {
    StorageSlotName::new(COUNT_SLOT).context("the count slot name is invalid")
}

/// Assembles the MASM counter account and registers it with the client.
async fn assemble_counter_contract(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
    fees: Option<&FeeContext>,
) -> Result<Account> {
    let component = AccountComponent::new(
        packages.counter_contract.clone(),
        vec![StorageSlot::with_empty_value(count_slot()?)],
        AccountComponentMetadata::new("counter_contract"),
    )
    .context("failed to build the MASM counter component")?;

    let mut init_seed = [0_u8; 32];
    client
        .rng()
        .try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;
    let mut builder = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(component)
        .with_component(NoAuth);
    for component in transacting_components(fees) {
        builder = builder.with_component(component);
    }
    // Plain `build`: the schema commitment slot the Rust fixtures carry commits
    // to the components' storage schemas, and a MASM package has none.
    let account = builder
        .build()
        .context("failed to build the MASM counter account")?;

    client
        .add_account(&account, false)
        .await
        .context("failed to add the account to the client")?;
    eprintln!(
        "Created MASM counter-contract account {}",
        account.id().to_hex()
    );
    Ok(account)
}

impl Fixtures {
    /// Renders `packages/test-utils/src/masm-fixtures.ts`, laid out as biome
    /// formats it (see `crate::fixtures`).
    pub fn render(&self) -> String {
        let account = &self.counter_contract;
        let note = &self.counter_note;
        let mut out = String::new();
        out.push_str(&format!(
            "// Generated by apps/api-compile/crates/generate-fixtures --mode masm against {}.\n",
            self.network_id
        ));
        out.push_str("// Do not edit by hand — regenerate with `pnpm generate-masm-fixtures`.\n\n");
        out.push_str(&format!(
            "export const MASM_COUNTER_CONTRACT_ID = \"{}\";\n",
            account.id().to_hex()
        ));
        out.push_str(&format!(
            "export const MASM_COUNTER_NOTE_ID =\n  \"{}\";\n\n",
            note.id().to_hex()
        ));
        out.push_str("export const masmAccounts = {\n");
        out.push_str(&entry(
            "MASM_COUNTER_CONTRACT_ID",
            &BASE64_STANDARD.encode(account.to_bytes()),
            &account.code().commitment().to_hex(),
        ));
        out.push_str("};\n\nexport const masmNotes = {\n");
        out.push_str(&entry(
            "MASM_COUNTER_NOTE_ID",
            &BASE64_STANDARD.encode(note.to_bytes()),
            &note.script().root().to_hex(),
        ));
        out.push_str("};\n");
        out
    }
}
