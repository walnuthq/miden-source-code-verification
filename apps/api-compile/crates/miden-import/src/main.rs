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
use miden_standards::account::{
    components::StandardAccountComponent, inspection::AccountSchemaCommitment,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
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

// --- Standard account components ---

/// The standard components an account's procedures make up, each with the
/// procedure roots it claims.
///
/// Mirrors `StandardAccountComponent::extract_standard_components` (which the
/// verifier reaches through `AccountComponentInterface::from_procedures`), whose
/// per-component step is private: a component is detected when every one of its
/// procedures is still unclaimed, and it then claims them. The order is the same
/// as upstream's and matters — `NoteCreator`'s only procedure is also one of
/// `BasicWallet`'s, so a full wallet must claim it first.
///
/// `SchemaCommitment` is appended to upstream's list, which leaves it out:
/// `build_with_schema_commitment`, what the miden CLI builds accounts with by
/// default, adds it to every account, so without it no such account could ever
/// have all its procedures accounted for.
fn standard_account_components(account: &Account) -> Vec<Value> {
    let components = [
        ("BasicWallet", StandardAccountComponent::BasicWallet),
        ("NoteCreator", StandardAccountComponent::NoteCreator),
        ("FungibleFaucet", StandardAccountComponent::FungibleFaucet),
        ("CodeInspection", StandardAccountComponent::CodeInspection),
        ("Authority", StandardAccountComponent::Authority),
        (
            "RoleBasedAccessControl",
            StandardAccountComponent::RoleBasedAccessControl,
        ),
        ("Ownable2Step", StandardAccountComponent::Ownable2Step),
        ("AuthSingleSig", StandardAccountComponent::AuthSingleSig),
        (
            "AuthGuardedMultisig",
            StandardAccountComponent::AuthGuardedMultisig,
        ),
        ("AuthMultisig", StandardAccountComponent::AuthMultisig),
        (
            "AuthMultisigSmart",
            StandardAccountComponent::AuthMultisigSmart,
        ),
        ("AuthNoAuth", StandardAccountComponent::AuthNoAuth),
        (
            "AuthNetworkAccount",
            StandardAccountComponent::AuthNetworkAccount,
        ),
    ]
    .into_iter()
    .map(|(name, component)| (name, component.procedure_roots().collect::<Vec<_>>()))
    .chain([(
        "SchemaCommitment",
        AccountSchemaCommitment::code().procedure_roots().collect(),
    )]);

    let mut unclaimed = BTreeSet::from_iter(account.code().procedures().iter().copied());
    let mut detected = Vec::new();
    for (name, roots) in components {
        if roots.iter().all(|root| unclaimed.contains(root)) {
            for root in &roots {
                unclaimed.remove(root);
            }
            let procedures: Vec<_> = roots.iter().map(|root| root.mast_root().to_hex()).collect();
            detected.push(json!({ "name": name, "procedures": procedures }));
        }
    }
    detected
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
            let standard_account_components = standard_account_components(&account);
            let procedures: Vec<_> = account
                .code()
                .procedures()
                .iter()
                .map(|root| root.mast_root().to_hex())
                .collect();
            json!({
                "type": "account",
                "code": code,
                "standardAccountComponents": standard_account_components,
                "procedures": procedures,
            })
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
