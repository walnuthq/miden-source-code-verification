//! Paying the transaction fee on a fee-charging chain, and the faucet funding
//! that makes it payable.
//!
//! A 0.16 node rejects any transaction carrying no non-zero TX_FEE output note
//! once the chain's `verification_base_fee` is non-zero — see
//! `ensure_transaction_has_fee` in the node's block producer. That note is
//! normally created by the account's authentication procedure out of its own
//! vault, which is not something the counter contracts can do: they authenticate
//! with `examples/counter-contract/auth-component-no-auth`, and midenc links
//! neither `miden::standards::fee` nor any Rust binding for the kernel's fee
//! procedures, so a Rust-compiled auth component cannot pay a fee at all.
//!
//! The protocol does not require the auth procedure to be the note's *creator*,
//! though — only that the transaction contains one. So [`FeeContext::fee_note`]
//! builds one here and the caller hands it to
//! [`TransactionRequestBuilder::own_output_notes`], which makes the client derive
//! a send-notes script that creates the note and funds it from the account's
//! vault. That leaves the vault to fill, which is what [`fund`] is for.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use miden_client::account::component::{BasicWallet, NoAuth};
use miden_client::account::{
    AccountBuilder, AccountBuilderSchemaCommitmentExt, AccountId, AccountType,
};
use miden_client::address::{Address, NetworkId};
use miden_client::asset::FungibleAsset;
use miden_client::block::BlockNumber;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::note::{Note, NoteId, NoteType, P2idNote, TxFeeNote};
use miden_client::transaction::TransactionRequestBuilder;
use miden_client::{Client, ClientRng};
use rand::TryRng;
use sha2::{Digest, Sha256};

use crate::account::wait_for_commitment;

/// How long to wait for the faucet's mint to show up in the client's store.
const MINT_TIMEOUT: Duration = Duration::from_secs(180);
const MINT_POLL_INTERVAL: Duration = Duration::from_secs(3);

const FAUCET_TIMEOUT: Duration = Duration::from_secs(60);

// --- Fee context ---

/// What a fee-charging chain costs, read once from the genesis block.
pub struct FeeContext {
    fee_faucet_id: AccountId,
    verification_base_fee: u32,
}

impl FeeContext {
    /// Reads the chain's fee parameters, or returns `None` when it charges
    /// nothing — in which case every caller keeps behaving exactly as it did
    /// before fees existed.
    ///
    /// The fee parameters are fixed at genesis and copied into every later block,
    /// so the genesis header is as good a source as the chain tip and is already
    /// in the store after the first sync.
    pub async fn detect(client: &Client<FilesystemKeyStore>) -> Result<Option<Self>> {
        let (genesis, _) = client
            .get_block_header_by_num(BlockNumber::GENESIS)
            .await
            .context("failed to read the genesis block header")?
            .context("the genesis block header is not in the client's store")?;

        let fee_parameters = genesis.fee_parameters();
        if fee_parameters.verification_base_fee() == 0 {
            return Ok(None);
        }

        Ok(Some(Self {
            fee_faucet_id: fee_parameters.fee_faucet_id(),
            verification_base_fee: fee_parameters.verification_base_fee(),
        }))
    }

    /// What every fee note this tool creates carries.
    ///
    /// The kernel prices a transaction at `verification_base_fee * ceil(log2(cycles))`,
    /// and the VM's cycle count cannot reach 2^64, so 64 base-fee units is an
    /// upper bound on any fee rather than merely a generous guess. Overpaying
    /// costs nothing that matters here: the surplus goes to whoever builds the
    /// batch, and these are throwaway fixture accounts on a test network.
    pub fn fee_note_amount(&self) -> u64 {
        u64::from(self.verification_base_fee) * 64
    }

    /// What each account this tool deploys is paid, ahead of its one transaction.
    fn account_funding(&self) -> u64 {
        self.fee_note_amount() * 4
    }

    /// Builds the TX_FEE note `account_id`'s transaction pays its fee with.
    ///
    /// The serial number is drawn rather than derived: `TxFeeNote::derive_serial_number`
    /// exists so a client can predict the note the *standard* auth components
    /// create, and nothing on-chain checks it.
    pub fn fee_note(&self, account_id: AccountId, rng: &mut ClientRng) -> Result<Note> {
        let asset = FungibleAsset::new(self.fee_faucet_id, self.fee_note_amount())
            .map_err(|err| anyhow!("failed to build the fee asset: {err}"))?;

        let note = TxFeeNote::builder()
            .sender(account_id)
            .asset(asset)
            .generate_serial_number(rng)
            .build()
            .map_err(|err| anyhow!("failed to build the fee note: {err}"))?;

        Ok(note.into())
    }
}

// --- Funding ---

/// Pays every account in `targets` enough of the native fee asset to cover its
/// own transaction, and returns the note carrying it.
///
/// The notes are returned rather than consumed here: a note's assets reach the
/// vault before the fee is withdrawn, so folding one into the account's own
/// transaction makes that transaction both the deploy and the payment. This is
/// the same shape `miden-client`'s `deploy_by_consuming` test helper uses.
///
/// The funds come from a throwaway wallet this function creates and has the
/// public faucet mint to. Unlike everything else deployed by this tool, that
/// wallet is assembled from the components `miden-standards` ships: `NoAuth` pays
/// its own fee out of the faucet note it consumes in the very same transaction,
/// which is exactly what none of the `examples/` components can do.
pub async fn fund(
    client: &mut Client<FilesystemKeyStore>,
    fees: &FeeContext,
    network_id: &NetworkId,
    faucet_url: &str,
    targets: &[AccountId],
) -> Result<BTreeMap<AccountId, Note>> {
    let funder = build_funder(client).await?;

    let payout = fees.account_funding();
    // Enough for every target, plus the funder's own fee for the transaction
    // paying them.
    let mint_amount = payout
        .checked_mul(targets.len() as u64)
        .and_then(|total| total.checked_add(fees.fee_note_amount()))
        .context("the funding amount overflowed")?;

    let minted = mint(client, network_id, faucet_url, funder, mint_amount).await?;

    let asset = FungibleAsset::new(fees.fee_faucet_id, payout)
        .map_err(|err| anyhow!("failed to build the funding asset: {err}"))?;

    let mut notes = BTreeMap::new();
    for target in targets.iter().copied() {
        let note = P2idNote::builder()
            .sender(funder)
            .target(target)
            .asset(asset)
            .note_type(NoteType::Public)
            .generate_serial_number(client.rng())
            .build()
            .map_err(|err| anyhow!("failed to build the funding note for {target}: {err}"))?;
        notes.insert(target, Note::from(note));
    }

    // One transaction pays them all, and is also the funder's own deploy: the
    // minted note lands in the vault first, so `NoAuth` has something to draw the
    // fee from.
    let request = TransactionRequestBuilder::new()
        .input_notes([(minted, None)])
        .own_output_notes(notes.values().cloned())
        .build()
        .context("failed to build the funding transaction request")?;
    let tx_id = client
        .submit_new_transaction(funder, request)
        .await
        .context("failed to submit the funding transaction")?;
    eprintln!("  submitted funding transaction {}", tx_id.to_hex());

    wait_for_commitment(client, tx_id).await?;

    Ok(notes)
}

/// Builds and registers the throwaway wallet the faucet mints to.
async fn build_funder(client: &mut Client<FilesystemKeyStore>) -> Result<AccountId> {
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
        .context("failed to build the funder account")?;

    client
        .add_account(&account, false)
        .await
        .context("failed to add the funder account to the client")?;
    eprintln!("Created funder account {}", account.id().to_hex());

    Ok(account.id())
}

// --- Faucet ---

/// Asks the public faucet to mint `amount` of the native fee asset to `target`,
/// and returns the note it created once the client can see it.
async fn mint(
    client: &mut Client<FilesystemKeyStore>,
    network_id: &NetworkId,
    faucet_url: &str,
    target: AccountId,
    amount: u64,
) -> Result<Note> {
    let address = Address::new(target).encode(network_id.clone());
    let http = reqwest::Client::builder()
        .timeout(FAUCET_TIMEOUT)
        .build()
        .context("failed to build the faucet HTTP client")?;

    let challenge: Challenge = get_json(
        &http,
        faucet_url,
        "pow",
        &[("account_id", address.clone()), ("amount", amount.to_string())],
    )
    .await?;

    // Solving is a tight hashing loop, so it does not belong on the async
    // runtime's worker thread. The faucet's difficulty is low enough that this
    // returns in well under a second.
    let target_value = challenge.target;
    let challenge_bytes = hex::decode(&challenge.challenge)
        .context("the faucet returned a challenge that is not hex")?;
    let nonce = tokio::task::spawn_blocking(move || solve(&challenge_bytes, target_value))
        .await
        .context("the proof-of-work task panicked")?;

    let minted: Minted = get_json(
        &http,
        faucet_url,
        "get_tokens",
        &[
            ("account_id", address),
            ("asset_amount", amount.to_string()),
            ("is_private_note", "false".to_string()),
            ("challenge", challenge.challenge),
            ("nonce", nonce.to_string()),
        ],
    )
    .await?;
    eprintln!(
        "  faucet minted {amount} to {} in note {}",
        target.to_hex(),
        minted.note_id
    );

    let note_id = NoteId::try_from_hex(&minted.note_id)
        .map_err(|err| anyhow!("the faucet returned an unreadable note id: {err}"))?;

    wait_for_note(client, note_id).await
}

/// Solves the faucet's proof-of-work challenge.
///
/// Valid when the first 8 bytes of `sha256(challenge || nonce)`, read as a
/// big-endian u64, are below the target — see `Challenge::validate_pow` in the
/// faucet's `pow` crate. The nonce is a plain counter: the faucet checks only the
/// hash, so there is nothing to gain from drawing it at random.
fn solve(challenge: &[u8], target: u64) -> u64 {
    for nonce in 0_u64.. {
        let mut hasher = Sha256::new();
        hasher.update(challenge);
        hasher.update(nonce.to_be_bytes());
        let digest = hasher.finalize();
        let value = u64::from_be_bytes(digest[..8].try_into().expect("sha256 is 32 bytes"));

        if value < target {
            return nonce;
        }
    }

    unreachable!("the nonce range is exhausted only after 2^64 hashes")
}

/// Polls until the minted note is in the client's store. The client registered a
/// note tag for the funder when the account was added, so a sync is all it takes.
async fn wait_for_note(client: &mut Client<FilesystemKeyStore>, note_id: NoteId) -> Result<Note> {
    let deadline = Instant::now() + MINT_TIMEOUT;

    loop {
        client.sync_state().await.context("failed to sync state")?;

        if let Some(record) = client
            .get_input_note(note_id)
            .await
            .context("failed to read back the minted note")?
        {
            return TryInto::<Note>::try_into(record)
                .map_err(|err| anyhow!("the minted note record carries no metadata: {err}"));
        }

        if Instant::now() >= deadline {
            bail!(
                "the faucet's note {} never reached the client after {}s",
                note_id.to_hex(),
                MINT_TIMEOUT.as_secs()
            );
        }
        tokio::time::sleep(MINT_POLL_INTERVAL).await;
    }
}

#[derive(serde::Deserialize)]
struct Challenge {
    challenge: String,
    target: u64,
}

#[derive(serde::Deserialize)]
struct Minted {
    note_id: String,
}

/// Calls one of the faucet's `GET` endpoints, reporting the body on failure —
/// the faucet answers a rejected request with a plain-text reason, which is the
/// only thing that distinguishes rate limiting from a stale challenge.
async fn get_json<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    faucet_url: &str,
    endpoint: &str,
    query: &[(&str, String)],
) -> Result<T> {
    let url = format!("{}/{endpoint}", faucet_url.trim_end_matches('/'));
    let response = http
        .get(&url)
        .query(query)
        .send()
        .await
        .with_context(|| format!("failed to reach the faucet at {url}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read the faucet's response from {url}"))?;

    if !status.is_success() {
        bail!("the faucet answered {status} at {url}: {body}");
    }

    serde_json::from_str(&body)
        .with_context(|| format!("failed to parse the faucet's response from {url}: {body}"))
}
