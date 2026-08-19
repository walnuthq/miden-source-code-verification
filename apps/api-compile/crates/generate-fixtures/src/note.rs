//! Creating the counter-note fixtures on-chain.

use anyhow::{Context, Result, anyhow};
use miden_client::account::component::BasicWallet;
use miden_client::account::{
    AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountId, AccountType,
};
use miden_client::auth::{Approver, AuthSchemeId, AuthSecretKey, AuthSingleSig};
use miden_client::crypto::FeltRng;
use miden_client::keystore::{FilesystemKeyStore, Keystore};
use miden_client::note::{
    Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
    PartialNoteMetadata,
};
use miden_client::transaction::TransactionRequestBuilder;
use miden_client::{Client, ClientRng};
use rand::TryRng;

use crate::account::wait_for_commitment;
use crate::build::Packages;

/// Emits both counter-note fixtures in a single transaction and returns them
/// once it is committed.
///
/// `target` is the counter-contract account the notes are tagged for. Nothing
/// consumes them — the tests only ever fetch them by id — but a note that could
/// never be consumed would be a misleading fixture.
pub async fn emit_counter_notes(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &FilesystemKeyStore,
    packages: &Packages,
    target: AccountId,
) -> Result<[Note; 2]> {
    let factory = build_note_factory(client, keystore).await?;

    let script = NoteScript::from_package(&packages.counter_note)
        .map_err(|err| anyhow!("failed to build the counter-note script: {err}"))?;

    // Same script, same (empty) storage and assets — only the serial number
    // differs. That is exactly what the registry tests need: two distinct note
    // ids resolving to one script root.
    let notes = [
        build_note(client.rng(), &script, factory, target)?,
        build_note(client.rng(), &script, factory, target)?,
    ];
    for note in &notes {
        eprintln!("Created counter-note {}", note.id().to_hex());
    }

    // No custom script: `own_output_notes` leaves the transaction script to the
    // client, which derives a `send_notes` script from the factory's interface.
    let request = TransactionRequestBuilder::new()
        .own_output_notes(notes.clone())
        .build()
        .context("failed to build the note-creating transaction request")?;
    let tx_id = client
        .submit_new_transaction(factory, request)
        .await
        .context("failed to submit the note-creating transaction")?;
    eprintln!("  submitted note-creating transaction {}", tx_id.to_hex());

    wait_for_commitment(client, tx_id).await?;

    Ok(notes)
}

/// Builds and registers the throwaway account that emits the notes.
///
/// Unlike every other account here this one is assembled from the components
/// `miden-standards` ships rather than from `examples/`, because
/// `own_output_notes` hands script building to the client and the send-notes
/// script is only derivable for an account exposing the *standard*
/// `BasicWallet` procedure roots. `examples/basic-wallet` compiles to different
/// roots, so it reads as a custom component and no such script exists for it.
///
/// The auth component is `AuthSingleSig` rather than `NoAuth` for a related
/// reason: no-auth only bumps the nonce when the account commitment moves, and
/// emitting asset-less notes touches neither vault nor storage. A no-auth
/// factory would sit at nonce 0, never commit, and take its output notes down
/// with it. Single-sig increments unconditionally, so deploying the factory and
/// emitting the notes happen in the same transaction.
async fn build_note_factory(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &FilesystemKeyStore,
) -> Result<AccountId> {
    let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let approver = Approver::new(
        key.public_key().to_commitment(),
        AuthSchemeId::Falcon512Poseidon2,
    );

    let mut init_seed = [0_u8; 32];
    client
        .rng()
        .try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(BasicWallet)
        .with_component(AuthSingleSig::new(approver))
        .build_with_schema_commitment()
        .context("failed to build the note factory account")?;

    keystore
        .add_key(&key, account.id())
        .await
        .context("failed to store the note factory's signing key")?;
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
