//! Runs the binary on dev packages assembled from `miden-assemble`'s test
//! projects, with `--sources`: what api-compile does for a MASM project.

use miden_assembly::{
    Assembler, ProjectTargetSelector,
    debuginfo::{DefaultSourceManager, SourceManager},
};
use miden_core_lib::CoreLibrary;
use miden_package_registry::{InMemoryPackageRegistry, PackageCache};
use miden_protocol::{ProtocolLib, transaction::TransactionKernel};
use miden_standards::StandardsLib;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

fn project(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../miden-assemble/tests/projects")
        .join(name)
}

/// The metadata of the dev package assembled from the project `name`.
fn metadata(name: &str) -> Value {
    let mut registry = InMemoryPackageRegistry::default();
    for package in [
        CoreLibrary::default().package(),
        ProtocolLib::default().package(),
        TransactionKernel::package(),
        StandardsLib::default().package(),
    ] {
        registry.cache_package(package).unwrap();
    }
    let source_manager: Arc<dyn SourceManager> = Arc::new(DefaultSourceManager::default());
    let package = Assembler::new(source_manager)
        .for_project_at_path(project(name).join("miden-project.toml"), &mut registry)
        .and_then(|mut assembler| assembler.assemble(ProjectTargetSelector::Library, "dev"))
        .unwrap_or_else(|report| panic!("{report:?}"));

    let masp = std::env::temp_dir().join(format!(
        "miden-package-metadata-{}-{name}.masp",
        std::process::id()
    ));
    package.write_to_file(&masp).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_miden-package-metadata"))
        .arg(&masp)
        .arg("--sources")
        .arg(project(name))
        .output()
        .unwrap();
    std::fs::remove_file(&masp).unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn an_account_component() {
    let metadata = metadata("counter-account");
    assert_eq!(metadata["kind"], "account-component");
    assert_eq!(
        metadata["readOnly"],
        json!({
            "::counter_account::get_count": true,
            "::counter_account::increment_count": false,
        })
    );
    assert_eq!(
        metadata["parameters"],
        json!({
            "::counter_account::get_count": [],
            "::counter_account::increment_count": [{ "name": "amount", "type": "felt" }],
        })
    );
    // A MASM package carries no schema.
    assert!(metadata.get("storage").is_none());
    assert!(metadata.get("noteStorage").is_none());
}

#[test]
fn a_foreign_procedure_invocation_is_found() {
    assert_eq!(
        metadata("fpi-account")["callsForeign"],
        json!({
            "::fpi_account::echo": false,
            "::fpi_account::read_foreign": true,
        })
    );
}

#[test]
fn a_note_and_a_transaction_script() {
    let note = metadata("increment-note");
    assert_eq!(note["kind"], "note");
    assert_eq!(note["parameters"], json!({ "::increment_note::main": [] }));
    let script = metadata("increment-script");
    assert_eq!(script["kind"], "transaction-script");
    // Both call the counter's `increment_count`, by its digest.
    assert_eq!(note["accountProcedures"].as_array().unwrap().len(), 1);
    assert_eq!(note["accountProcedures"], script["accountProcedures"]);
    assert!(note.get("noteStorage").is_none());
}
