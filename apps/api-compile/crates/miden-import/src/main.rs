use anyhow::{Result, anyhow, bail};
use clap::Parser;
use miden_client::{
    account::{Account, AccountId},
    address::{Address, AddressId, NetworkId},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    note::{NoteFile, NoteId},
    rpc::{Endpoint, GrpcClient},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use serde_json::json;
use std::sync::Arc;

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    #[arg(long, default_value = "mtst")]
    network_id: String,

    #[arg(long)]
    resource_id: String,
}

// --- Resource parsing ---

enum Resource {
    Account {
        network_id: Option<NetworkId>,
        account_id: AccountId,
    },
    Note(NoteId),
}

fn parse_resource_id(resource_id: &str) -> Result<Resource> {
    if let Ok((account_id, network_id)) = AccountId::parse(resource_id) {
        return Ok(Resource::Account {
            network_id,
            account_id,
        });
    }
    if let Ok((network_id, address)) = Address::decode(resource_id) {
        let AddressId::AccountId(account_id) = address.id() else {
            bail!("address '{}' does not contain an account ID", resource_id);
        };
        return Ok(Resource::Account {
            network_id: Some(network_id),
            account_id,
        });
    }
    if let Ok(note_id) = NoteId::try_from_hex(resource_id) {
        return Ok(Resource::Note(note_id));
    }
    bail!(
        "'{}' is not a valid account address, account ID, or note ID",
        resource_id
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let args_network_id = NetworkId::new(&args.network_id)?;
    // Initialize client
    let endpoint = match args_network_id.as_str() {
        "mtst" => Endpoint::testnet(),
        "mdev" => Endpoint::devnet(),
        "mlcl" => Endpoint::localhost(),
        _ => Endpoint::testnet(),
    };
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Initialize keystore
    let keystore_path = std::path::PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path)?);

    let store_path = std::path::PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await?;

    let output = match parse_resource_id(&args.resource_id)? {
        Resource::Account {
            network_id: network_id_opt,
            account_id,
        } => {
            if let Some(network_id) = network_id_opt {
                if network_id != args_network_id {
                    bail!(
                        "network ID of resource ({}) does not match provided network ID ({})",
                        network_id.as_str(),
                        args_network_id.as_str()
                    );
                }
            }

            client.import_account_by_id(account_id).await?;
            let account_record = client
                .get_account(account_id)
                .await?
                .ok_or_else(|| anyhow!("account '{}' not found", args.resource_id))?;
            let account =
                Account::try_from(account_record).map_err(|e: std::convert::Infallible| {
                    anyhow!("Account is missing full account data: {}", e)
                })?;

            let code = account.code().commitment().to_hex();
            json!({ "type": "account", "code": code })
        }
        Resource::Note(note_id) => {
            client.import_notes(&[NoteFile::NoteId(note_id)]).await?;
            let note_record = client
                .get_input_note(note_id)
                .await?
                .ok_or_else(|| anyhow!("note '{}' not found", args.resource_id))?;
            let code = note_record.details().script().root().to_hex();
            json!({ "type": "note", "code": code })
        }
    };

    println!("{}", output);
    Ok(())
}
