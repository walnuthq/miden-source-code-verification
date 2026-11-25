//! Assembles the MASM project at an entrypoint of a project root into a
//! dev package (with debug info), and prints the outcome as JSON.
//!
//! A failed build is an answer, as for `POST /compile` (ADR 0001): the tool
//! exits 0 and prints `{ "built": false, "builtWith", "rendered",
//! "diagnostics" }`. A built one prints `{ "built": true, "builtWith",
//! "rendered", "diagnostics" }`, its warnings in `diagnostics` and rendered
//! (empty when there are none), and writes the package.
//! A non-zero exit is the tool's own failure: bad arguments, an unreadable
//! directory, a package it can't write.

use anyhow::{Context, Result, bail};
use clap::Parser;
use miden_assembly::diagnostics::Report;
use miden_assembly::{Assembler, ProjectTargetSelector, debuginfo::SourceManager};
use miden_core_lib::CoreLibrary;
use miden_mast_package::Package;
use miden_package_registry::{InMemoryPackageRegistry, PackageCache};
use miden_protocol::{ProtocolLib, transaction::TransactionKernel};
use miden_standards::StandardsLib;
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

mod confine;
mod diagnostics;
mod sources;

/// The profile every build uses: the dev one keeps the debug info, and shares
/// its procedure roots and commitment with a release build.
const PROFILE: &str = "dev";

/// The versions the tool was built with, read from the lockfile by `build.rs`.
const BUILT_WITH: &str = env!("MIDEN_ASSEMBLE_BUILT_WITH");

/// Assembles a MASM project into a dev package (.masp) and prints the outcome
/// as JSON.
#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// The project root: no build reads outside it.
    project_root: PathBuf,
    /// The directory, relative to the project root, whose
    /// `miden-project.toml` is assembled. `.` for the project root itself.
    entrypoint: PathBuf,
    /// Where to write the package.
    masp_path: PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    if args.entrypoint.is_absolute()
        || args
            .entrypoint
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        bail!("the entrypoint must be a path inside the project root");
    }
    let root = args.project_root.canonicalize().with_context(|| {
        format!(
            "failed to read the project root '{}'",
            args.project_root.display()
        )
    })?;
    // Resolved before the tool moves into the project root, which a relative
    // package path would otherwise be read against.
    let masp_path = std::path::absolute(&args.masp_path)?;
    // The sources are named relative to the root (see `sources`): run from
    // there, so those names read the files they name.
    std::env::set_current_dir(&root)
        .with_context(|| format!("failed to enter the project root '{}'", root.display()))?;
    let output = assemble(&root, &args.entrypoint, &masp_path)?;
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

/// Assembles the project at `entrypoint` in `root`, which must be canonical,
/// and writes the package to `masp_path` when it builds.
fn assemble(root: &Path, entrypoint: &Path, masp_path: &Path) -> Result<Value> {
    confine::check_ancestors(root)?;
    if let Some(refusal) = confine::check_project(root)? {
        let report = Report::msg(format!("{}: {}", refusal.file, refusal.reason));
        let diagnostic = json!({
            "severity": "error",
            "message": refusal.reason,
            "file": refusal.file,
        });
        return Ok(failed(&report, root, vec![diagnostic]));
    }

    let manifest = root.join(entrypoint).join(confine::MANIFEST);
    if !manifest.is_file() {
        // The assembler says only `No such file or directory`.
        let file = confine::relative(&manifest, root);
        let message = format!("there is no {file}");
        let diagnostic = json!({ "severity": "error", "message": message });
        return Ok(failed(&Report::msg(message), root, vec![diagnostic]));
    }
    let package = match build(&manifest, root, false) {
        Ok(package) => package,
        Err(report) => {
            let diagnostics = diagnostics::collect(&report, root, None);
            return Ok(failed(&report, root, diagnostics));
        }
    };
    package
        .write_to_file(masp_path)
        .with_context(|| format!("failed to write the package to '{}'", masp_path.display()))?;

    // The assembler prints the warnings of a build that succeeds to stderr as
    // text, and returns none of them. Treated as errors, they fail a second
    // build, which reports them with their spans; it stops at the first module
    // that has any, so a project with warnings in two modules lists the first
    // module's only.
    let (rendered, warnings) = match build(&manifest, root, true) {
        Ok(_) => (String::new(), vec![]),
        Err(report) => (
            diagnostics::render(&report, root),
            diagnostics::collect(&report, root, Some("warning")),
        ),
    };
    Ok(json!({
        "built": true,
        "builtWith": BUILT_WITH,
        "rendered": rendered,
        "diagnostics": warnings,
    }))
}

/// A failed build's answer: `report` rendered, and its `diagnostics`.
fn failed(report: &Report, root: &Path, diagnostics: Vec<Value>) -> Value {
    json!({
        "built": false,
        "builtWith": BUILT_WITH,
        "rendered": diagnostics::render(report, root),
        "diagnostics": diagnostics,
    })
}

/// One assembly of the project whose manifest is `manifest`, in the project at
/// `root`, against the core, protocol, transaction kernel and standards
/// packages. Its sources are named relative to `root`.
fn build(manifest: &Path, root: &Path, warnings_as_errors: bool) -> Result<Arc<Package>, Report> {
    let mut registry = InMemoryPackageRegistry::default();
    for package in [
        CoreLibrary::default().package(),
        ProtocolLib::default().package(),
        TransactionKernel::package(),
        StandardsLib::default().package(),
    ] {
        registry
            .cache_package(package)
            .expect("the four packages are distinct");
    }
    let source_manager: Arc<dyn SourceManager> = Arc::new(sources::ProjectSourceManager::new(root));
    Assembler::new(source_manager)
        .with_warnings_as_errors(warnings_as_errors)
        .for_project_at_path(manifest, &mut registry)?
        .assemble(ProjectTargetSelector::Library, PROFILE)
}
