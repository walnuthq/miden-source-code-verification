//! Waiting for a fixture's transaction to be committed on-chain.

use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use miden_client::Client;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::store::TransactionFilter;
use miden_client::transaction::{TransactionId, TransactionStatus};

/// How long to wait for a deploying transaction to be committed on-chain.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);
const COMMIT_POLL_INTERVAL: Duration = Duration::from_secs(3);

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
