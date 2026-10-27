use anyhow::{Result, anyhow};
use base64::prelude::*;
use clap::Parser;
use miden_assembly_syntax::ast::types::CallConv;
use miden_client::{
    ClientError,
    account::{Account, AccountComponentInterfaceExt, AccountId},
    address::{Address, AddressId, NetworkId},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    note::{Note, NoteFile, NoteId, NoteScript},
    rpc::{Endpoint, GrpcClient},
    transaction::AccountComponentInterface,
    utils::Deserializable,
    vm::{Package, PackageExport},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
// use miden_standards::account::access::{Authority, Ownable2Step, RoleBasedAccessControl};
// use miden_standards::account::auth::{
//     AuthGuardedMultisig, AuthMultisig, AuthMultisigSmart, AuthNetworkAccount, AuthSingleSig, NoAuth,
// };
// use miden_standards::account::faucets::FungibleFaucet;
// use miden_standards::account::wallets::BasicWallet;
// use miden_standards::note::{
//     BurnNote, MintNote, P2idNote, P2ideNote, PswapNote, StandardNote, SwapNote, TxFeeNote,
// };
use miden_standards::note::StandardNote;
use serde_json::{Value, json};
use std::fmt;
use std::fs;
use std::process::ExitCode;
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

// --- Errors ---

/// A request that can never verify: the resource doesn't exist or can't be
/// imported, the ID doesn't name one, or the package or resource can't be
/// read. It exits with `REJECTED_EXIT_CODE`, so api-compile can tell it apart
/// from a failure that may go away on a retry (an RPC timeout, a node hiccup,
/// a store error), which exits with 1.
#[derive(Debug)]
struct Rejected(String);

impl fmt::Display for Rejected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Rejected {}

const REJECTED_EXIT_CODE: u8 = 2;

macro_rules! rejected {
    ($($arg:tt)*) => {
        return Err(Rejected(format!($($arg)*)).into())
    };
}

/// Marks an error the request's own inputs caused.
fn rejected(error: impl fmt::Display) -> anyhow::Error {
    Rejected(error.to_string()).into()
}

/// Classifies the client errors that say the resource can never be imported.
fn import_error(error: ClientError) -> anyhow::Error {
    match &error {
        ClientError::AccountNotFoundOnChain(_)
        | ClientError::AccountIsPrivate(_)
        | ClientError::NoteNotFoundOnChain(_) => rejected(error),
        // The node answers an unknown note ID with no notes rather than an
        // error, and the client reports that, and a private note, only by
        // message. Only one note is ever requested, so an empty answer means
        // it's missing.
        ClientError::NoteImportError(message)
            if message == "No notes fetched from node"
                || message == "Incomplete imported note is private" =>
        {
            rejected(error)
        }
        _ => error.into(),
    }
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
            rejected!("address '{}' does not contain an account ID", resource_id);
        };
        return Ok(Resource::Account {
            network_id: Some(network_id),
            account_id,
        });
    }
    if let Ok(note_id) = NoteId::try_from_hex(resource_id) {
        return Ok(Resource::Note(note_id));
    }
    rejected!(
        "'{}' is not a valid account address, account ID, or note ID",
        resource_id
    )
}

fn verify_account_component(account: Account, package: Package) -> Result<Value> {
    // `AccountInterface::from_account` would be the obvious call here, but it
    // asserts that exactly one of the account's components is a *standard* auth
    // component and panics when that does not hold. Every account this API
    // exists to verify authenticates with a Rust-compiled component (see
    // `examples/counter-contract/auth-component-no-auth`), which classifies as
    // `CustomAuth` rather than one of the `Auth*` variants, so the assertion never
    // holds. Classifying the procedures directly yields the same component list
    // without going through that constructor.
    let interface = AccountComponentInterface::from_procedures(account.code().procedures());
    let mut components = Vec::new();
    let mut has_custom_code = false;
    for component in &interface {
        let name = match component {
            AccountComponentInterface::BasicWallet => "BasicWallet",
            AccountComponentInterface::NoteCreator => "NoteCreator",
            AccountComponentInterface::FungibleFaucet => "FungibleFaucet",
            AccountComponentInterface::CodeInspection => "CodeInspection",
            AccountComponentInterface::Authority => "Authority",
            AccountComponentInterface::Ownable2Step => "Ownable2Step",
            AccountComponentInterface::RoleBasedAccessControl => "RoleBasedAccessControl",
            AccountComponentInterface::AuthSingleSig => "AuthSingleSig",
            AccountComponentInterface::AuthMultisig => "AuthMultisig",
            AccountComponentInterface::AuthMultisigSmart => "AuthMultisigSmart",
            AccountComponentInterface::AuthGuardedMultisig => "AuthGuardedMultisig",
            AccountComponentInterface::AuthNoAuth => "AuthNoAuth",
            AccountComponentInterface::AuthNetworkAccount => "AuthNetworkAccount",
            AccountComponentInterface::AuthTxFeeCollector => "AuthTxFeeCollector",
            // A non-standard auth procedure gets its own `CustomAuth` bucket
            // instead of landing in `Custom` with the rest, so an account whose
            // only custom code is its auth component has no `Custom` at all.
            // Both are code a package can account for.
            AccountComponentInterface::CustomAuth(_) | AccountComponentInterface::Custom(_) => {
                has_custom_code = true;
                continue;
            }
        };
        components.push(name.to_string());
    }

    if has_custom_code {
        if package.manifest.num_exports() == 0 {
            rejected!("Package has no exports");
        }
        // Only the procedures exported with the ComponentModel calling
        // convention (`CallConv::ComponentModel`) are installed as account
        // procedures — the same rule `verify_note_script` applies to pick out a
        // note's entrypoint. Everything else a package exports is internal to
        // the toolchain: the Wasm-ABI adapter generated around each procedure,
        // `cabi_realloc`, and `init`. Matching against those too could never
        // verify, because none of them is part of the account's code.
        let procedures: Vec<_> = package
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure),
                _ => None,
            })
            .filter(|procedure| {
                procedure
                    .signature
                    .as_ref()
                    .is_some_and(|signature| signature.abi == CallConv::ComponentModel)
            })
            .collect();
        // `all` holds vacuously on an empty iterator, so a package that
        // exports no account procedures at all — a transaction script, say
        // — would otherwise report as verified against any account.
        let verified = !procedures.is_empty()
            && procedures
                .iter()
                .all(|procedure| account.code().has_procedure(procedure.digest));
        if verified {
            components.push(format!("Custom({})", package.dependency_commitment()));
        }
    }

    let code = account.code().commitment().to_hex();
    Ok(json!({ "type": "account", "code": code, "components": components }))
}

fn verify_note_script(note_script: &NoteScript, package: Package) -> Result<Value> {
    let script = if let Some(standard_note) = StandardNote::from_script(note_script) {
        standard_note.name().to_string()
    } else {
        // The note script's entrypoint is the procedure exported with the
        // ComponentModel calling convention (`CallConv::ComponentModel`).
        let entrypoint = package
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure),
                _ => None,
            })
            .find(|procedure| {
                procedure
                    .signature
                    .as_ref()
                    .is_some_and(|signature| signature.abi == CallConv::ComponentModel)
            });
        match entrypoint {
            Some(procedure) if procedure.digest == note_script.root().into() => {
                format!("Custom({})", package.dependency_commitment())
            }
            _ => String::new(),
        }
    };
    let code = note_script.root().to_hex();
    Ok(json!({ "type": "note", "code": code, "script": script }))
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // The same output as returning the error from `main`.
            eprintln!("Error: {error:?}");
            if error.is::<Rejected>() {
                ExitCode::from(REJECTED_EXIT_CODE)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}

async fn run() -> Result<()> {
    /*println!("standard notes script roots");
    println!();
    println!("P2ID: {}", P2idNote::script_root());
    println!("P2IDE: {}", P2ideNote::script_root());
    println!("SWAP: {}", SwapNote::script_root());
    println!("PSWAP: {}", PswapNote::script_root());
    println!("MINT: {}", MintNote::script_root());
    println!("BURN: {}", BurnNote::script_root());
    println!("TX_FEE: {}", TxFeeNote::script_root());
    println!();
    println!("standard account components");
    let components = vec![
        ("BasicWallet", BasicWallet::code()),
        ("FungibleFaucet", FungibleFaucet::code()),
        ("Authority", Authority::code()),
        ("Ownable2Step", Ownable2Step::code()),
        ("RoleBasedAccessControl", RoleBasedAccessControl::code()),
        ("AuthSingleSig", AuthSingleSig::code()),
        ("AuthMultisig", AuthMultisig::code()),
        ("AuthMultisigSmart", AuthMultisigSmart::code()),
        ("AuthGuardedMultisig", AuthGuardedMultisig::code()),
        ("AuthNoAuth", NoAuth::code()),
        ("AuthNetworkAccount", AuthNetworkAccount::code()),
    ];
    for (name, code) in components {
        println!();
        println!("{} {}", name, code.as_package().digest().to_hex());
        for export in code.exports() {
            println!(
                "{} {}",
                export.path,
                code.get_procedure_root_by_path(&export.path)
                    .unwrap()
                    .mast_root()
                    .to_hex()
            );
        }
    }*/
    let args = Args::parse();
    let args_network_id = NetworkId::new(&args.network_id)
        .map_err(|error| rejected(format!("invalid network ID: {error}")))?;
    // Initialize client
    let endpoint = match args_network_id.as_str() {
        "mtst" => Endpoint::testnet(),
        "mdev" => Endpoint::devnet(),
        "mlcl" => Endpoint::localhost(),
        other => rejected!("unsupported network ID `{other}`; expected `mtst`, `mdev` or `mlcl`"),
    };
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Each network gets its own store and keystore. The client pins the
    // genesis commitment of the first node it syncs with and sends it with
    // every later request, so a store shared between networks gets every
    // request to the other network rejected.
    let network_dir = std::path::PathBuf::from(args_network_id.as_str());

    // Initialize keystore
    let keystore_path = network_dir.join("keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path)?);

    let store_path = network_dir.join("store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await?;

    let package_bytes = fs::read(&args.masp_path)?;
    let package = Package::read_from_bytes(&package_bytes)
        .map_err(|error| rejected(format!("invalid package: {error}")))?;

    let output = match parse_resource_id(&args.resource_id)? {
        Resource::Account {
            network_id: network_id_opt,
            account_id,
        } => {
            if let Some(network_id) = network_id_opt
                && network_id != args_network_id
            {
                rejected!(
                    "network ID of resource ({}) does not match provided network ID ({})",
                    network_id.as_str(),
                    args_network_id.as_str()
                );
            }

            let account = if let Some(resource_path) = args.resource_path {
                let resource = fs::read_to_string(&resource_path)?;
                let resource_bytes = BASE64_STANDARD.decode(resource).map_err(rejected)?;
                Account::read_from_bytes(&resource_bytes).map_err(rejected)?
            } else {
                client
                    .import_account_by_id(account_id)
                    .await
                    .map_err(import_error)?;
                client
                    .get_account(account_id)
                    .await?
                    .ok_or_else(|| anyhow!("account '{}' not found", args.resource_id))?
            };

            verify_account_component(account, package)?
        }
        Resource::Note(note_id) => {
            let note_script = if let Some(resource_path) = args.resource_path {
                let resource = fs::read_to_string(&resource_path)?;
                let resource_bytes = BASE64_STANDARD.decode(resource).map_err(rejected)?;
                let note = Note::read_from_bytes(&resource_bytes).map_err(rejected)?;
                note.script().clone()
            } else {
                client
                    .import_notes(&[NoteFile::NoteId(note_id)])
                    .await
                    .map_err(import_error)?;
                let note_record = client
                    .get_input_note(note_id)
                    .await?
                    .ok_or_else(|| anyhow!("note '{}' not found", args.resource_id))?;
                note_record.details().script().clone()
            };

            verify_note_script(&note_script, package)?
        }
    };

    println!("{}", output);
    Ok(())
}
