//! Generates `packages/test-utils/src/standard-fixtures.ts`: one account per
//! account component `miden-standards` ships, and one note per note script its
//! library holds, built offline from the packages the crate embeds.
//!
//! Nothing here touches a network. The api-compile suite compiles the verbatim
//! copy of the crate's MASM in `apps/api-compile/miden-standards` and checks it
//! against them: each component package to the commitment the fixture records,
//! each note script to its note's root. It also sends their serialized bytes
//! as `/verify`'s `resource`, to check that standard code is never verified.
//!
//! The components are listed from the copy's workspace manifest, and each
//! member must map to a component in `standard_components::STANDARD_COMPONENTS`:
//! a component a newer crate adds fails the run until it is listed there. The notes need no table:
//! they are the library's exports marked `@note_script`.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use base64::prelude::*;
use clap::Parser;
use miden_protocol::account::component::AccountComponentMetadata;
use miden_protocol::account::{
    Account, AccountBuilder, AccountComponent, AccountComponentCode, AccountId,
};
use miden_protocol::note::{
    Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteType, PartialNoteMetadata,
};
use miden_protocol::utils::serde::Serializable;
use miden_protocol::vm::PackageExport;
use miden_protocol::{Felt, Word};
use miden_standards::StandardsLib;
use miden_standards::account::auth::NoAuth;
use miden_standards::account::wallets::BasicWallet;
use miden_standards::note::StandardNote;
use sha2::{Digest, Sha256};
use standard_components::STANDARD_COMPONENTS;

#[derive(Parser, Debug)]
#[command(about)]
struct Args {
    /// The copy of the crate's MASM: the directory holding `asm`.
    #[arg(long)]
    standards_dir: PathBuf,

    /// Write the generated fixtures here instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

struct ComponentFixture {
    package: String,
    entrypoint: String,
    commitment: String,
    account: Account,
}

struct NoteFixture {
    key: String,
    path: String,
    note: Note,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let components = component_fixtures(&args.standards_dir)?;
    let sender = components
        .first()
        .context("the workspace lists no components")?
        .account
        .id();
    let notes = note_fixtures(sender)?;
    let library = StandardsLib::default().package();
    let output = render(
        &library.dependency_commitment().to_hex(),
        &components,
        &notes,
    );
    match args.out {
        Some(path) => std::fs::write(&path, output)
            .with_context(|| format!("failed to write '{}'", path.display()))?,
        None => print!("{output}"),
    }
    Ok(())
}

/// The workspace members of the copy's `asm/components`, each with the name
/// of the package its manifest declares.
fn workspace_members(standards_dir: &Path) -> Result<Vec<(String, String)>> {
    let components_dir = standards_dir.join("asm/components");
    let read = |path: PathBuf| -> Result<toml::Table> {
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read '{}'", path.display()))?;
        text.parse()
            .with_context(|| format!("failed to parse '{}'", path.display()))
    };
    let workspace = read(components_dir.join("miden-project.toml"))?;
    let members = workspace
        .get("workspace")
        .and_then(|workspace| workspace.get("members"))
        .and_then(|members| members.as_array())
        .context("asm/components/miden-project.toml lists no workspace members")?;
    members
        .iter()
        .map(|member| {
            let member = member
                .as_str()
                .context("a workspace member isn't a string")?;
            let manifest = read(components_dir.join(member).join("miden-project.toml"))?;
            let name = manifest
                .get("package")
                .and_then(|package| package.get("name"))
                .and_then(|name| name.as_str())
                .with_context(|| format!("member '{member}' names no package"))?;
            Ok((member.to_string(), name.to_string()))
        })
        .collect()
}

/// One account per workspace member: the member's component, plus `NoAuth`,
/// or `BasicWallet` when the component is an auth component. Storage is left
/// empty: only the code is checked.
fn component_fixtures(standards_dir: &Path) -> Result<Vec<ComponentFixture>> {
    let mut by_package: BTreeMap<String, &'static AccountComponentCode> = BTreeMap::new();
    for (_, code) in STANDARD_COMPONENTS {
        let code = code();
        by_package.insert(code.as_package().name.to_string(), code);
    }
    let mut fixtures = Vec::new();
    for (member, package) in workspace_members(standards_dir)? {
        let Some(code) = by_package.remove(&package) else {
            bail!(
                "workspace member '{member}' is package '{package}', which \
                 `standard_components::STANDARD_COMPONENTS` doesn't list: add it there"
            );
        };
        let component = component(code, &package)?;
        // An account needs exactly one auth component and at least one
        // procedure that isn't one.
        let companion = if component.is_auth_component() {
            self::component(BasicWallet::code(), "basic-wallet")?
        } else {
            self::component(NoAuth::code(), "no-auth")?
        };
        let account = AccountBuilder::new(seed(&package))
            .with_component(companion)
            .with_component(component)
            .build()
            .with_context(|| format!("failed to build an account with '{package}'"))?;
        fixtures.push(ComponentFixture {
            entrypoint: format!("asm/components/{member}"),
            commitment: code.as_package().dependency_commitment().to_hex(),
            package,
            account,
        });
    }
    if !by_package.is_empty() {
        let missing: Vec<_> = by_package.keys().cloned().collect();
        bail!("STANDARD_COMPONENTS lists packages the workspace doesn't: {missing:?}");
    }
    Ok(fixtures)
}

fn component(code: &AccountComponentCode, name: &str) -> Result<AccountComponent> {
    Ok(AccountComponent::new(
        code.clone(),
        vec![],
        AccountComponentMetadata::new(name),
    )?)
}

/// A seed of the package's own, so every account keeps its ID from one run
/// to the next.
fn seed(name: &str) -> [u8; 32] {
    Sha256::digest(name.as_bytes()).into()
}

/// One public note per procedure the library marks `@note_script`, sent by
/// `sender`, with no assets and as many zero storage items as the script
/// accepts.
fn note_fixtures(sender: AccountId) -> Result<Vec<NoteFixture>> {
    let library = StandardsLib::default().package();
    let mut fixtures = Vec::new();
    for (index, export) in library.manifest.exports().enumerate() {
        let PackageExport::Procedure(procedure) = export else {
            continue;
        };
        if !procedure.attributes.has("note_script") {
            continue;
        }
        let script = NoteScript::from_package_reference(&library, &procedure.path)
            .with_context(|| format!("failed to read note script '{}'", procedure.path))?;
        let standard = StandardNote::from_script(&script);
        let num_storage_items = standard
            .map(|standard| {
                let accepted = standard.num_storage_items();
                // The smallest storage the note accepts: every standard note
                // takes a few items, so 1024 only bounds the search.
                (0..=1024)
                    .find(|&count| accepted.accepts(count))
                    .context("no storage size is accepted")
            })
            .transpose()?
            .unwrap_or(0);
        let storage = NoteStorage::new(vec![Felt::ZERO; num_storage_items])?;
        let serial_num = Word::from([Felt::from(index as u32), Felt::ZERO, Felt::ZERO, Felt::ONE]);
        let recipient = NoteRecipient::new(serial_num, script, storage);
        let metadata = PartialNoteMetadata::new(sender, NoteType::Public);
        let note = Note::new(NoteAssets::default(), metadata, recipient);
        fixtures.push(NoteFixture {
            key: standard
                .map(|standard| standard.name().to_string())
                .unwrap_or_else(|| procedure.path.to_string()),
            path: procedure.path.to_string(),
            note,
        });
    }
    Ok(fixtures)
}

fn render(
    library_commitment: &str,
    components: &[ComponentFixture],
    notes: &[NoteFixture],
) -> String {
    let mut out = String::new();
    out.push_str(
        "// Generated by apps/api-compile/crates/generate-fixtures (bin standard-fixtures).\n\
         // Do not edit by hand — regenerate with `pnpm --filter ./apps/api-compile sync-miden-standards`.\n\
         //\n\
         // Offline accounts and notes built from the packages `miden-standards` ships: none\n\
         // of them is on chain, so a test sends `resource` with its ID.\n\n",
    );
    out.push_str("// The standards library: the package that holds every standard note script.\n");
    let _ = writeln!(
        out,
        "export const standardsLibrary = {{\n  entrypoint: \"asm/standards\",\n  commitment: \"{library_commitment}\",\n}};\n"
    );
    out.push_str(
        "// One account per component package, keyed by package name: the component,\n\
         // plus `NoAuth`, or `BasicWallet` for an auth component. `entrypoint` is the member's\n\
         // directory in `apps/api-compile/miden-standards`, `commitment` the package's.\n",
    );
    out.push_str("export const standardComponents = {\n");
    for fixture in components {
        let account = &fixture.account;
        let _ = writeln!(
            out,
            "  \"{}\": {{\n    entrypoint: \"{}\",\n    commitment: \"{}\",\n    accountId: \"{}\",\n    code: \"{}\",\n    resource:\n      \"{}\",\n  }},",
            fixture.package,
            fixture.entrypoint,
            fixture.commitment,
            account.id().to_hex(),
            account.code().commitment().to_hex(),
            BASE64_STANDARD.encode(account.to_bytes()),
        );
    }
    out.push_str("};\n\n");
    out.push_str(
        "// One note per note script of the library, keyed by its standard note name.\n\
         // `path` is the library export the script is, `root` the script root.\n",
    );
    out.push_str("export const standardNotes = {\n");
    for fixture in notes {
        let note = &fixture.note;
        let _ = writeln!(
            out,
            "  \"{}\": {{\n    path: \"{}\",\n    noteId: \"{}\",\n    root: \"{}\",\n    resource:\n      \"{}\",\n  }},",
            fixture.key,
            fixture.path,
            note.id().to_hex(),
            Word::from(note.script().root()).to_hex(),
            BASE64_STANDARD.encode(note.to_bytes()),
        );
    }
    out.push_str("};\n");
    out
}
