//! Creating the counter-note fixtures on-chain.

use anyhow::{Context, Result, anyhow};
use miden_client::account::component::{BasicWallet, NoAuth};
use miden_client::account::{
    AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountId, AccountType,
};
use miden_client::crypto::FeltRng;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::note::{
    Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
    PartialNoteMetadata,
};
use miden_client::transaction::TransactionRequestBuilder;
use miden_client::{Client, ClientRng};
use rand::TryRng;

use crate::account::wait_for_commitment;
use crate::build::Packages;

/// Every counter-note this tool emits.
pub struct Notes {
    /// The two the tests look up by id. Nothing consumes them: the registry needs
    /// two distinct note ids resolving to one script root, and a spent note would
    /// be a poor fixture for that.
    pub fixtures: [Note; 2],
    /// One per counter contract, consumed by it in its own transaction. This is
    /// what runs `increment_count` — see [`crate::account::deploy_counter_contract`]
    /// for why the counter-note carries the increment rather than
    /// `examples/counter-contract/counter-script`.
    pub increments: [Note; 2],
}

/// Emits every counter-note in a single transaction and returns them once it is
/// committed.
///
/// `counter_contracts` are the accounts the notes are tagged for. They only have
/// to be assembled, not yet deployed: a note is tagged with an account id, and
/// the id is fixed the moment the account is built.
///
/// `funding` is the note the factory pays its own transaction fee out of, or
/// `None` on a chain that charges none.
pub async fn emit_notes(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
    factory: AccountId,
    counter_contracts: [AccountId; 2],
    funding: Option<Note>,
) -> Result<Notes> {
    let script = NoteScript::from_package(&packages.counter_note)
        .map_err(|err| anyhow!("failed to build the counter-note script: {err}"))?;

    // Same script, same (empty) storage and assets — only the serial number
    // differs. That is exactly what the registry tests need: two distinct note
    // ids resolving to one script root.
    let fixtures = [
        build_note(client.rng(), &script, factory, counter_contracts[0])?,
        build_note(client.rng(), &script, factory, counter_contracts[0])?,
    ];
    for note in &fixtures {
        eprintln!("Created counter-note {}", note.id().to_hex());
    }

    let increments = [
        build_note(client.rng(), &script, factory, counter_contracts[0])?,
        build_note(client.rng(), &script, factory, counter_contracts[1])?,
    ];
    for note in &increments {
        eprintln!("Created increment note {}", note.id().to_hex());
    }

    // No custom script: `own_output_notes` leaves the transaction script to the
    // client, which derives a `send_notes` script from the factory's interface.
    let request = TransactionRequestBuilder::new()
        .input_notes(funding.map(|note| (note, None)))
        .own_output_notes(fixtures.iter().chain(increments.iter()).cloned())
        .build()
        .context("failed to build the note-creating transaction request")?;
    let tx_id = client
        .submit_new_transaction(factory, request)
        .await
        .context("failed to submit the note-creating transaction")?;
    eprintln!("  submitted note-creating transaction {}", tx_id.to_hex());

    wait_for_commitment(client, tx_id).await?;

    Ok(Notes {
        fixtures,
        increments,
    })
}

/// Builds and registers the throwaway account that emits the notes.
///
/// Unlike every other account here this one is assembled from the components
/// `miden-standards` ships rather than from `examples/`, and both halves have to
/// be:
///
/// - `own_output_notes` hands script building to the client, and the send-notes
///   script is only derivable for an account exposing the *standard* wallet
///   procedure roots. `examples/basic-wallet` compiles to different roots, so it
///   reads as a custom component and no such script exists for it.
/// - `NoAuth` pays the transaction fee out of the account's vault, which is the
///   whole reason the factory can transact on a fee-charging chain at all: no
///   component compiled by midenc can create a fee note, since midenc links
///   neither `miden::standards::fee` nor a Rust binding for the kernel's fee
///   procedures. It also bumps the nonce for an account at nonce 0 even when
///   nothing else moved, which matters because emitting asset-less notes touches
///   neither vault nor storage — and an account left at nonce 0 is one the kernel
///   rejects outright for an account-creating transaction.
///
/// So deploying the factory and emitting the notes stay one transaction, with the
/// funding note it consumes covering the fee. It is built ahead of that
/// transaction rather than inside it because the funder has to know where to send
/// that note.
pub async fn create_factory(client: &mut Client<FilesystemKeyStore>) -> Result<AccountId> {
    let mut init_seed = [0_u8; 32];
    client
        .rng()
        .try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build_with_schema_commitment()
        .context("failed to build the note factory account")?;

    client
        .add_account(&account, false)
        .await
        .context("failed to add the note factory account to the client")?;
    eprintln!("Created note factory account {}", account.id().to_hex());

    Ok(account.id())
}

fn build_note(
    rng: &mut ClientRng,
    script: &NoteScript,
    sender: AccountId,
    target: AccountId,
) -> Result<Note> {
    // The counter-note script takes no inputs: `run(self, _arg, account)` reads
    // everything it needs off the account it executes against.
    let recipient = NoteRecipient::new(rng.draw_word(), script.clone(), NoteStorage::default());
    // Public, so the node keeps the full note and serves it back by id — which
    // is what `GET /:networkId/import/:resourceId` relies on.
    let metadata = PartialNoteMetadata::new(sender, NoteType::Public)
        .with_tag(NoteTag::with_account_target(target));
    let assets =
        NoteAssets::new(vec![]).map_err(|err| anyhow!("failed to build note assets: {err}"))?;

    Ok(Note::new(assets, metadata, recipient))
}
