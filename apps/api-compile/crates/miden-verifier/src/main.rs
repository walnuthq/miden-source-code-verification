use anyhow::{Result, anyhow, bail};
use base64::prelude::*;
use clap::Parser;
use miden_client::{
    account::{Account, AccountId, AccountInterfaceExt},
    address::{Address, AddressId, NetworkId},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    note::{Note, NoteFile, NoteId, NoteScript},
    rpc::{Endpoint, GrpcClient},
    transaction::{AccountComponentInterface, AccountInterface},
    utils::Deserializable,
    vm::{Package, PackageExport},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
// use miden_standards::account::components::{
//     basic_fungible_faucet_library, basic_wallet_library, multisig_library, multisig_psm_library,
//     network_fungible_faucet_library, no_auth_library, singlesig_acl_library, singlesig_library,
// };
// use miden_standards::note::{BurnNote, MintNote, P2idNote, P2ideNote, StandardNote, SwapNote};
use miden_standards::note::StandardNote;
use std::fs;
use std::sync::Arc;

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    #[arg(long, default_value = "mtst")]
    network_id: String,

    #[arg(long)]
    resource_id: String,

    #[arg(long)]
    resource_path: Option<String>,

    #[arg(long)]
    masp_path: String,
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

fn verify_account_component(account: Account, package: Package) -> Result<()> {
    let account_interface = AccountInterface::from_account(&account);
    for component in account_interface.components() {
        match component {
            AccountComponentInterface::BasicWallet => println!("BasicWallet"),
            AccountComponentInterface::BasicFungibleFaucet => {
                println!("BasicFungibleFaucet")
            }
            AccountComponentInterface::NetworkFungibleFaucet => {
                println!("NetworkFungibleFaucet")
            }
            AccountComponentInterface::AuthSingleSig => {
                println!("AuthSingleSig")
            }
            AccountComponentInterface::AuthSingleSigAcl => {
                println!("AuthSingleSigAcl")
            }
            AccountComponentInterface::AuthMultisig => {
                println!("AuthMultisig")
            }
            AccountComponentInterface::AuthMultisigPsm => {
                println!("AuthMultisigPsm")
            }
            AccountComponentInterface::AuthNoAuth => println!("AuthNoAuth"),
            AccountComponentInterface::Custom(_) => {
                if package.manifest.num_exports() == 0 {
                    bail!("Package has no exports");
                }
                let mut procedures = package
                    .manifest
                    .exports()
                    .filter_map(|export| match export {
                        PackageExport::Procedure(procedure) => Some(procedure),
                        _ => None,
                    });
                let verified =
                    procedures.all(|procedure| account.code().has_procedure(procedure.digest));
                if verified {
                    println!("Custom({})", package.digest());
                }
            }
        }
    }

    Ok(())
}

fn verify_note_script(note_script: &NoteScript, package: Package) -> Result<()> {
    if let Some(standard_note) = StandardNote::from_script(note_script) {
        println!("{}", standard_note.name());
    } else {
        let mut procedures = package
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure),
                _ => None,
            });
        let run_procedure_opt =
            procedures.find(|procedure| procedure.path.as_str().ends_with("::run"));
        if let Some(run_procedure) = run_procedure_opt {
            let verified = run_procedure.digest == note_script.root();
            if verified {
                println!("Custom({})", package.digest());
            }
        } else {
            bail!("Run procedure not found");
        }
    }
    Ok(())
}

// cargo run --release
#[tokio::main]
async fn main() -> Result<()> {
    // println!("standard notes script roots");
    // println!("P2ID: {}", P2idNote::script_root());
    // println!("P2IDE: {}", P2ideNote::script_root());
    // println!("SWAP: {}", SwapNote::script_root());
    // println!("MINT: {}", MintNote::script_root());
    // println!("BURN: {}", BurnNote::script_root());
    // println!("standard account components");
    // let libraries = vec![
    //     basic_wallet_library(),
    //     basic_fungible_faucet_library(),
    //     network_fungible_faucet_library(),
    //     singlesig_library(),
    //     singlesig_acl_library(),
    //     multisig_library(),
    //     multisig_psm_library(),
    //     no_auth_library(),
    // ];
    // for library in libraries {
    //     println!("{}", library.digest().to_hex());
    //     let exports: Vec<_> = library.exports().collect();
    //     for export in exports {
    //         println!(
    //             "{} {}",
    //             export.path(),
    //             library
    //                 .get_procedure_root_by_path(export.path())
    //                 .unwrap()
    //                 .to_hex()
    //         );
    //     }
    // }
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

    let package_bytes = fs::read(&args.masp_path)?;
    let package = Package::read_from_bytes(&package_bytes)?;

    match parse_resource_id(&args.resource_id)? {
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

            let account = if let Some(resource_path) = args.resource_path {
                let resource = fs::read_to_string(&resource_path)?;
                let resource_bytes = BASE64_STANDARD.decode(resource)?;
                Account::read_from_bytes(&resource_bytes)?
            } else {
                client.import_account_by_id(account_id).await?;
                let account_record = client.get_account(account_id).await?.unwrap();
                Account::try_from(account_record).map_err(|e: std::convert::Infallible| {
                    anyhow!("Account is missing full account data: {}", e)
                })?
            };

            verify_account_component(account, package)
        }
        Resource::Note(note_id) => {
            let note_script = if let Some(resource_path) = args.resource_path {
                let resource = fs::read_to_string(&resource_path)?;
                let resource_bytes = BASE64_STANDARD.decode(resource)?;
                let note = Note::read_from_bytes(&resource_bytes)?;
                note.script().clone()
            } else {
                client.import_notes(&[NoteFile::NoteId(note_id)]).await?;
                let note_record = client.get_input_note(note_id).await?.unwrap();
                note_record.details().script().clone()
            };

            verify_note_script(&note_script, package)
        }
    }
}
