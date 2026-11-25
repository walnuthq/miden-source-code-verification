//! The assembly itself, shared by the binary and by `generate-fixtures`, which
//! deploys the packages it builds.

use miden_assembly::diagnostics::Report;
use miden_assembly::{Assembler, ProjectTargetSelector, debuginfo::SourceManager};
use miden_core_lib::CoreLibrary;
use miden_mast_package::Package;
use miden_package_registry::{InMemoryPackageRegistry, PackageCache};
use miden_protocol::{ProtocolLib, transaction::TransactionKernel};
use miden_standards::StandardsLib;
use std::path::Path;
use std::sync::Arc;

mod sources;

/// The profile every build uses: the dev one keeps the debug info, and shares
/// its procedure roots and commitment with a release build.
const PROFILE: &str = "dev";

/// One assembly of the project whose manifest is `manifest`, in the project at
/// `root`, which must be canonical, against the core, protocol, transaction
/// kernel and standards packages. Its sources are named relative to `root`, so
/// the caller runs with `root` as its working directory.
pub fn build(
    manifest: &Path,
    root: &Path,
    warnings_as_errors: bool,
) -> Result<Arc<Package>, Report> {
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
