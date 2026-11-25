//! The names of each exported procedure's parameters, from the MASM source of
//! a package that `miden-assembly` built.
//!
//! Such a package has no WIT section, and its manifest's signatures carry the
//! parameters' types but not their names. The source does:
//! `pub proc increment_count(amount: felt)`. The library target of the
//! project's `miden-project.toml` is parsed as the assembler parses it, and
//! each export is paired with the procedure at its path.
//!
//! A project that can't be read is reported on stderr and gives `None`, so
//! names the tool can't read never fail a build.

use miden_assembly_syntax::ast::{self, ModuleKind};
use miden_assembly_syntax::debuginfo::{DefaultSourceManager, SourceManager, Spanned};
use miden_assembly_syntax::parser::read_modules_from_root;
use miden_assembly_syntax::prettier::PrettyPrint;
use miden_mast_package::{Package, PackageExport};
use miden_project::Project;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

/// Each exported procedure's parameters, by export path, in the manifest's
/// export order: `[{ "name", "type" }]`, both as the source spells them
/// (`amount`, `felt`, `word`, `AccountId`). An export is left out when its procedure
/// isn't found, names none of its parameters, or has another number of them
/// than its signature, so the two lists pair by index. `project` is the
/// directory holding the package's `miden-project.toml`.
pub fn package(package: &Package, project: &Path) -> Option<Map<String, Value>> {
    let signatures = signatures(project)
        .inspect_err(|error| eprintln!("failed to read the project's sources: {error}"))
        .ok()?;

    let mut parameters = Map::new();
    for export in package.manifest.exports() {
        let PackageExport::Procedure(procedure) = export else {
            continue;
        };
        let Some(signature) = &procedure.signature else {
            continue;
        };
        let path = procedure.path.to_string();
        let Some(source) = signatures.get(path.trim_start_matches("::")) else {
            continue;
        };
        if source.len() != signature.params.len() {
            continue;
        }
        let params = source
            .iter()
            .map(|(name, ty)| {
                name.as_ref()
                    .map(|name| json!({ "name": name, "type": ty }))
            })
            .collect::<Option<Vec<_>>>();
        if let Some(params) = params {
            parameters.insert(path, json!(params));
        }
    }
    Some(parameters)
}

/// A procedure's parameters: each one's name, when the source gives it, and
/// its type as the source spells it.
type Parameters = Vec<(Option<String>, String)>;

/// The parameters of every procedure in the library target of the project in
/// `project`, by its path without the leading `::`.
fn signatures(project: &Path) -> Result<HashMap<String, Parameters>, String> {
    let source_manager: Arc<dyn SourceManager> = Arc::new(DefaultSourceManager::default());
    let manifest = Project::load(project, source_manager.as_ref())
        .map_err(|error| error.to_string())?
        .package();
    let target = manifest
        .library_target()
        .ok_or("the project has no library target")?;
    let directory = manifest
        .manifest_path()
        .and_then(Path::parent)
        .unwrap_or(project);
    let (root, support) = read_modules_from_root(
        directory.join(target.path.path()),
        Some(target.namespace.inner().clone()),
        Some(ModuleKind::Library),
        source_manager.clone(),
        false,
    )
    .map_err(|error| error.to_string())?;

    let mut signatures = HashMap::new();
    for module in std::iter::once(&root).chain(&support) {
        for procedure in module.procedures() {
            let Some(signature) = procedure.signature() else {
                continue;
            };
            let path = format!("{}::{}", module.path(), procedure.name());
            let parameters = signature
                .args
                .iter()
                .enumerate()
                .map(|(index, ty)| {
                    let name = signature.arg_names.get(index).cloned().flatten();
                    (
                        name.map(|name| name.as_str().to_string()),
                        spelling(ty, source_manager.as_ref()),
                    )
                })
                .collect();
            signatures.insert(path.trim_start_matches("::").to_string(), parameters);
        }
    }
    Ok(signatures)
}

/// `ty` as its source spells it (`word`, which the parser reads as
/// `[felt; 4]`), or as the parser prints it when its span can't be read.
fn spelling(ty: &ast::TypeExpr, source_manager: &dyn SourceManager) -> String {
    source_manager
        .source_slice(ty.span())
        .map(str::to_string)
        .unwrap_or_else(|_| ty.to_pretty_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_assembly_syntax::ast::types::{CallConv, FunctionType, Type};
    use miden_assembly_syntax::ast::{Path as AstPath, PathBuf as AstPathBuf};
    use miden_mast_package::{PackageManifest, ProcedureExport, Word};
    use miden_standards::StandardsLib;
    use std::path::PathBuf;

    /// A project of `miden-assemble`'s tests.
    fn project(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../miden-assemble/tests/projects")
            .join(name)
    }

    /// An export at `path` whose signature has `params` parameters.
    fn export(path: &str, params: usize) -> PackageExport {
        let path = AstPathBuf::new(path).expect("a valid path");
        let signature =
            FunctionType::new(CallConv::ComponentModel, vec![Type::Felt; params], vec![]);
        PackageExport::Procedure(ProcedureExport::new(
            Arc::<AstPath>::from(path.as_path()),
            None,
            Word::default(),
            Some(signature),
        ))
    }

    fn package(exports: Vec<PackageExport>) -> Package {
        let mut package = Package::clone(&StandardsLib::default().package());
        package.manifest = PackageManifest::new(exports).unwrap();
        package.sections = vec![];
        package
    }

    #[test]
    fn names_and_types_as_the_source_spells_them() {
        let counter = package(vec![
            export("::counter_account::get_count", 0),
            export("::counter_account::increment_count", 1),
        ]);
        assert_eq!(
            Value::Object(super::package(&counter, &project("counter-account")).unwrap()),
            json!({
                "::counter_account::get_count": [],
                "::counter_account::increment_count": [{ "name": "amount", "type": "felt" }],
            })
        );

        let fpi = package(vec![export("::fpi_account::read_foreign", 2)]);
        assert_eq!(
            Value::Object(super::package(&fpi, &project("fpi-account")).unwrap()),
            json!({
                "::fpi_account::read_foreign": [
                    { "name": "foreign_account_id", "type": "AccountId" },
                    // Not `[felt; 4]`, as the parser prints it.
                    { "name": "foreign_proc_root", "type": "word" },
                ],
            })
        );
    }

    #[test]
    fn leaves_out_exports_it_cannot_pair() {
        let package = package(vec![
            // One parameter more than the source's.
            export("::counter_account::increment_count", 2),
            // Not in the source.
            export("::counter_account::reset", 0),
            export("::counter_account::get_count", 0),
        ]);
        assert_eq!(
            super::package(&package, &project("counter-account"))
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            vec!["::counter_account::get_count"]
        );
    }

    #[test]
    fn an_unreadable_project_gives_none() {
        let package = package(vec![export("::counter_account::get_count", 0)]);
        assert_eq!(super::package(&package, &project("nowhere")), None);
    }
}
