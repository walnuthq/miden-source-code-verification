//! Creating the counter-note fixtures on-chain.

use anyhow::{Context, Result, anyhow};
use miden_client::account::component::{AccountComponentMetadata, BasicWallet};
use miden_client::account::{
    AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountComponent, AccountId, AccountType,
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

/// Name of the auth component the note factory is built with, see
/// [`build_note_factory`].
const FACTORY_AUTH_NAME: &str = "walnut::fixtures::note_factory_auth";

/// The note factory's authentication procedure: bump the nonce, pay no fee.
///
/// It is the same procedure `miden-standards` ships as its `incr_nonce` testing
/// component, minus the test-only packaging — see [`build_note_factory`] for why
/// none of the auth components meant for production can be used here.
const FACTORY_AUTH_CODE: &str = "
    use miden::protocol::native_account

    @auth_script
    pub proc auth_incr_nonce
        dropw
        exec.native_account::incr_nonce drop
    end
";

/// Emits both counter-note fixtures in a single transaction and returns them
/// once it is committed.
///
/// `target` is the counter-contract account the notes are tagged for. Nothing
/// consumes them — the tests only ever fetch them by id — but a note that could
/// never be consumed would be a misleading fixture.
pub async fn emit_counter_notes(
    client: &mut Client<FilesystemKeyStore>,
    packages: &Packages,
    target: AccountId,
) -> Result<[Note; 2]> {
    let factory = build_note_factory(client).await?;

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
/// Unlike every other account here this one is not assembled from `examples/`,
/// because both halves of it have to satisfy constraints the examples do not.
///
/// The wallet half is the `BasicWallet` component `miden-standards` ships rather
/// than `examples/basic-wallet`, because `own_output_notes` hands script building
/// to the client and the send-notes script is only derivable for an account
/// exposing the *standard* wallet procedure roots. `examples/basic-wallet`
/// compiles to different roots, so it reads as a custom component and no such
/// script exists for it.
///
/// The auth half is compiled here rather than taken from either source, because
/// nothing on offer fits a brand-new account holding no assets:
///
/// - Every auth component `miden-standards` ships (`NoAuth`, `AuthSingleSig`, …)
///   pays the transaction fee out of the account's vault. The fee is
///   `verification_base_fee * ceil(log2(cycles))`, and devnet prices the base fee
///   at 10000, so it is never zero and an empty vault can never cover it. That is
///   what this factory used to fail on: `AuthSingleSig` aborts with "paying a
///   non-zero fee requires conversion info committed via the auth args" before it
///   even gets as far as the vault.
/// - `examples/counter-contract/auth-component-no-auth` pays no fee, which is
///   exactly why the counter contracts can deploy themselves, but it only bumps
///   the nonce when the account commitment moves. Emitting asset-less notes
///   touches neither vault nor storage, so a factory using it would sit at nonce
///   0 — which the kernel rejects outright for an account-creating transaction.
///
/// So the factory authenticates with an unconditional nonce bump and no fee at
/// all, which leaves deploying it and emitting the notes as one transaction.
async fn build_note_factory(client: &mut Client<FilesystemKeyStore>) -> Result<AccountId> {
    let auth_code = client
        .code_builder()
        .compile_component_code(FACTORY_AUTH_NAME, FACTORY_AUTH_CODE)
        .map_err(|err| anyhow!("failed to compile the note factory's auth component: {err}"))?;
    let auth_component = AccountComponent::new(
        auth_code,
        vec![],
        AccountComponentMetadata::new(FACTORY_AUTH_NAME)
            .with_description("Increments the nonce and pays no transaction fee"),
    )
    .map_err(|err| anyhow!("failed to build the note factory's auth component: {err}"))?;

    let mut init_seed = [0_u8; 32];
    client
        .rng()
        .try_fill_bytes(&mut init_seed)
        .context("failed to draw an account seed")?;

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(BasicWallet)
        .with_component(auth_component)
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
