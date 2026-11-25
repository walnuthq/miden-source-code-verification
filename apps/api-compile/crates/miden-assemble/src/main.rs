//! Assembles the MASM project at an entrypoint of a project root into a
//! dev package (with debug info), and prints the outcome as JSON.
//!
//! A failed build is an answer, as for `POST /compile` (ADR 0001): the tool
//! exits 0 and prints `{ "built": false, "builtWith", "rendered",
//! "diagnostics" }`. A built one prints `{ "built": true, "builtWith",
//! "diagnostics" }`, its warnings in `diagnostics`, and writes the package.
//! A non-zero exit is the tool's own failure: bad arguments, an unreadable
//! directory, a package it can't write.

use anyhow::{Context, Result, bail};
use clap::Parser;
use miden_assembly::diagnostics::Report;
use miden_assembly::{
    Assembler, ProjectTargetSelector,
    debuginfo::{DefaultSourceManager, SourceManager},
};
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
    out: PathBuf,
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
    let output = assemble(&root, &args.entrypoint, &args.out)?;
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

/// Assembles the project at `entrypoint` in `root`, which must be canonical,
/// and writes the package to `out` when it builds.
fn assemble(root: &Path, entrypoint: &Path, out: &Path) -> Result<Value> {
    confine::check_ancestors(root)?;
    if let Some(refusal) = confine::check_manifests(root)? {
        let report = Report::msg(format!("{}: {}", refusal.manifest, refusal.reason));
        return Ok(json!({
            "built": false,
            "builtWith": BUILT_WITH,
            "rendered": diagnostics::render(&report, root),
            "diagnostics": [{
                "severity": "error",
                "message": refusal.reason,
                "file": refusal.manifest,
            }],
        }));
    }

    let manifest = root.join(entrypoint).join(confine::MANIFEST);
    if !manifest.is_file() {
        // The assembler says only `No such file or directory`.
        let file = confine::relative(&manifest, root);
        let message = format!("there is no {file}");
        return Ok(json!({
            "built": false,
            "builtWith": BUILT_WITH,
            "rendered": diagnostics::render(&Report::msg(message.clone()), root),
            "diagnostics": [{ "severity": "error", "message": message }],
        }));
    }
    let package = match build(&manifest, false) {
        Ok(package) => package,
        Err(report) => {
            return Ok(json!({
                "built": false,
                "builtWith": BUILT_WITH,
                "rendered": diagnostics::render(&report, root),
                "diagnostics": diagnostics::collect(&report, root, None),
            }));
        }
    };
    package
        .write_to_file(out)
        .with_context(|| format!("failed to write the package to '{}'", out.display()))?;

    // The assembler prints the warnings of a build that succeeds to stderr as
    // text, and returns none of them. Treated as errors, they fail a second
    // build, which reports them with their spans; it stops at the first module
    // that has any, so a project with warnings in two modules lists the first
    // module's only.
    let warnings = match build(&manifest, true) {
        Ok(_) => vec![],
        Err(report) => diagnostics::collect(&report, root, Some("warning")),
    };
    Ok(json!({
        "built": true,
        "builtWith": BUILT_WITH,
        "diagnostics": warnings,
    }))
}

/// One assembly of the project whose manifest is `manifest`, against the
/// core, protocol, transaction kernel and standards packages.
fn build(manifest: &Path, warnings_as_errors: bool) -> Result<Arc<Package>, Report> {
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
    let source_manager: Arc<dyn SourceManager> = Arc::new(DefaultSourceManager::default());
    Assembler::new(source_manager)
        .with_warnings_as_errors(warnings_as_errors)
        .for_project_at_path(manifest, &mut registry)?
        .assemble(ProjectTargetSelector::Library, PROFILE)
}
