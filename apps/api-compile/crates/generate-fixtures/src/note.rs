//! The throwaway account that emits the fixture notes, and the notes.

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
use miden_client::{Client, ClientRng};
use rand::TryRng;

/// Builds and registers the throwaway account that emits the notes.
///
/// It is assembled from the components `miden-standards` ships, and both halves
/// have to be:
///
/// - `own_output_notes` hands script building to the client, and the send-notes
///   script is only derivable for an account exposing the *standard* wallet
///   procedure roots. `examples/basic-wallet` is a component of its own, with
///   other roots, so no such script exists for it.
/// - `NoAuth` pays the transaction fee out of the account's vault, which is the
///   whole reason the factory can transact on a fee-charging chain at all.
///   It also bumps the nonce for an account at nonce 0 even when
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

pub fn build_note(
    rng: &mut ClientRng,
    script: &NoteScript,
    sender: AccountId,
    target: AccountId,
) -> Result<Note> {
    // The script takes no inputs: it reads everything it needs off the account
    // it executes against and the note itself.
    let recipient = NoteRecipient::new(rng.draw_word(), script.clone(), NoteStorage::default());
    // Public, so the node keeps the full note and serves it back by id — which
    // is what `GET /:networkId/import/:resourceId` relies on.
    let metadata = PartialNoteMetadata::new(sender, NoteType::Public)
        .with_tag(NoteTag::with_account_target(target));
    let assets =
        NoteAssets::new(vec![]).map_err(|err| anyhow!("failed to build note assets: {err}"))?;

    Ok(Note::new(assets, metadata, recipient))
}
