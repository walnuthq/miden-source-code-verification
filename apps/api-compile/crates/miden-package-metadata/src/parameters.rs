//! The names of each exported procedure's parameters, from the component's
//! public WIT that `cargo-miden` embeds in the package.
//!
//! A manifest's signature gives a procedure's parameter types but not their
//! names. The WIT does: `deposit: func(depositor: account-id, deposit-asset:
//! asset);`. It is parsed without resolving the packages it `use`s
//! (`miden:base/core-types`, which the section doesn't contain), so a type is
//! known by the name it is used under, which is all this reports.
//!
//! Only account components and notes carry the section: a transaction script
//! exports `miden:base`'s own interface and has none. A package without it
//! gets an empty map; a section that fails to parse is reported on stderr and
//! gives `None`, so names the tool can't read never fail a build.

use miden_mast_package::{Package, PackageExport, SectionId};
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use wit_parser::{AstItem, Function, Type, UnresolvedPackage, UnresolvedPackageGroup};

/// The id of the section `cargo-miden` writes the component's public WIT to:
/// `PACKAGE_WIT_SECTION_ID` in `midenc-frontend-wasm-metadata`. The compiler
/// plans an upstream `SectionId::WIT` to replace it.
const WIT_SECTION: &str = "wit";

/// Each exported procedure's parameters, by export path, in the manifest's
/// export order: `[{ "name", "type" }]`, both as the WIT spells them. An
/// export is left out when its WIT function isn't found or has another number
/// of parameters than its signature, so the two lists pair by index. An empty
/// map for a package without the section, `None` for one that can't be read.
pub fn package(package: &Package) -> Option<Map<String, Value>> {
    let id = SectionId::custom(WIT_SECTION).expect("a valid section id");
    let Some(section) = package.sections.iter().find(|section| section.id == id) else {
        return Some(Map::new());
    };
    let source = std::str::from_utf8(&section.data)
        .inspect_err(|error| eprintln!("failed to read the WIT section: {error}"))
        .ok()?;
    let group = UnresolvedPackageGroup::parse("wit", source)
        .inspect_err(|(map, error)| {
            eprintln!("failed to parse the WIT section: {}", error.render(map))
        })
        .ok()?;
    let wit = Wit::new(&group.main);

    let mut parameters = Map::new();
    for export in package.manifest.exports() {
        let PackageExport::Procedure(procedure) = export else {
            continue;
        };
        let Some(signature) = &procedure.signature else {
            continue;
        };
        // `::"<interface>"::<function>`, the quotes left out.
        let components = procedure
            .path
            .components()
            .filter_map(Result::ok)
            .map(|component| component.as_str())
            .filter(|component| *component != "::")
            .collect::<Vec<_>>();
        let [interface, function] = components[..] else {
            continue;
        };
        let Some(function) = wit.function(interface, function) else {
            continue;
        };
        if function.params.len() != signature.params.len() {
            continue;
        }
        let params = function
            .params
            .iter()
            .map(|param| json!({ "name": param.name, "type": wit.type_name(&param.ty) }))
            .collect::<Vec<_>>();
        parameters.insert(procedure.path.to_string(), json!(params));
    }
    Some(parameters)
}

/// The package's own interfaces, which its exports' paths name.
struct Wit<'a> {
    package: &'a UnresolvedPackage,
    /// Interfaces of the packages it `use`s, which the parser lists beside its
    /// own.
    foreign: HashSet<wit_parser::InterfaceId>,
}

impl<'a> Wit<'a> {
    fn new(package: &'a UnresolvedPackage) -> Self {
        let foreign = package
            .foreign_deps
            .values()
            .flat_map(|interfaces| interfaces.values())
            .filter_map(|(item, _)| match item {
                AstItem::Interface(id) => Some(*id),
                AstItem::World(_) => None,
            })
            .collect();
        Self { package, foreign }
    }

    /// The function `name` of the interface whose id
    /// (`<namespace>:<package>/<interface>@<version>`) is `interface`. A name
    /// escaped in the WIT (`%run`) is found by its plain name, as the parser
    /// drops the `%`.
    fn function(&self, interface: &str, name: &str) -> Option<&'a Function> {
        self.package
            .interfaces
            .iter()
            .filter(|(id, _)| !self.foreign.contains(id))
            .find(|(_, candidate)| {
                candidate
                    .name
                    .as_deref()
                    .is_some_and(|candidate| self.package.name.interface_id(candidate) == interface)
            })
            .and_then(|(_, interface)| interface.functions.get(name))
    }

    /// A type as the WIT names it (`felt`, `account-id`, `u64`), or its
    /// structural kind when it has no name (`list`, `option`, `tuple`).
    fn type_name(&self, ty: &Type) -> &'a str {
        match ty {
            Type::Bool => "bool",
            Type::U8 => "u8",
            Type::U16 => "u16",
            Type::U32 => "u32",
            Type::U64 => "u64",
            Type::S8 => "s8",
            Type::S16 => "s16",
            Type::S32 => "s32",
            Type::S64 => "s64",
            Type::F32 => "f32",
            Type::F64 => "f64",
            Type::Char => "char",
            Type::String => "string",
            Type::ErrorContext => "error-context",
            Type::Id(id) => {
                let def = &self.package.types[*id];
                def.name.as_deref().unwrap_or(def.kind.as_str())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_assembly_syntax::ast::types::{CallConv, FunctionType, Type as HirType};
    use miden_assembly_syntax::ast::{Path, PathBuf};
    use miden_mast_package::{PackageManifest, ProcedureExport, Section, Word};
    use miden_standards::StandardsLib;
    use std::sync::Arc;

    const BANK_WIT: &str = r#"// This file is auto-generated by the `#[component]` macro.
// Do not edit this file manually.

package miden:bank-account@0.1.0;

use miden:base/core-types@1.0.0;

interface bank {
    use core-types.{account-id, asset, felt, word};

    initialize: func();
    get-depositor-balance: func(depositor: account-id, asset: asset) -> felt;
    deposit: func(depositor: account-id, deposit-asset: asset);
    withdraw: func(withdraw-asset: asset, serial-num: word, tag: felt, note-type: felt);
    batch: func(amounts: list<u64>, memo: option<string>);
}

world bank-world {
    export bank;
}
"#;

    const NOTE_WIT: &str = r#"package miden:deposit-note@0.1.0;

use miden:base/core-types@1.0.0;

interface miden-deposit-note {
    use core-types.{word};

    %run: func(arg: word);
}

world miden-deposit-note-world {
    export miden-deposit-note;
}
"#;

    const BANK: &str = "miden:bank-account/bank@0.1.0";

    /// An export at `::"<interface>"::<function>` whose signature has
    /// `params` parameters.
    fn export(interface: &str, function: &str, params: usize) -> PackageExport {
        let path =
            PathBuf::new(&format!("::\"{interface}\"::\"{function}\"")).expect("a valid path");
        let signature = FunctionType::new(
            CallConv::ComponentModel,
            vec![HirType::Felt; params],
            vec![],
        );
        PackageExport::Procedure(ProcedureExport::new(
            Arc::<Path>::from(path.as_path()),
            None,
            Word::default(),
            Some(signature),
        ))
    }

    /// A package with `exports` and, when given, `wit` as its WIT section.
    fn package(exports: Vec<PackageExport>, wit: Option<&[u8]>) -> Package {
        let mut package = Package::clone(&StandardsLib::default().package());
        package.manifest = PackageManifest::new(exports).unwrap();
        package.sections = wit
            .map(|wit| Section::new(SectionId::custom(WIT_SECTION).unwrap(), wit.to_vec()))
            .into_iter()
            .collect();
        package
    }

    fn path(interface: &str, function: &str) -> String {
        let quoted = if function.contains('-') {
            format!("\"{function}\"")
        } else {
            function.to_string()
        };
        format!("::\"{interface}\"::{quoted}")
    }

    #[test]
    fn names_and_types_in_export_order() {
        let package = package(
            vec![
                export(BANK, "deposit", 2),
                export(BANK, "initialize", 0),
                export(BANK, "batch", 2),
            ],
            Some(BANK_WIT.as_bytes()),
        );
        let parameters = super::package(&package).unwrap();
        assert_eq!(
            Value::Object(parameters.clone()),
            json!({
                path(BANK, "deposit"): [
                    { "name": "depositor", "type": "account-id" },
                    { "name": "deposit-asset", "type": "asset" },
                ],
                path(BANK, "initialize"): [],
                // Types without a name give their kind.
                path(BANK, "batch"): [
                    { "name": "amounts", "type": "list" },
                    { "name": "memo", "type": "option" },
                ],
            })
        );
        // In the manifest's export order, which `preserve_order` keeps.
        let keys = parameters.keys().cloned().collect::<Vec<_>>();
        let manifest_order = package
            .manifest
            .exports()
            .map(|export| export.as_procedure().unwrap().path.to_string())
            .collect::<Vec<_>>();
        assert_eq!(keys, manifest_order);
    }

    #[test]
    fn finds_dashed_and_escaped_names() {
        let bank = package(
            vec![export(BANK, "get-depositor-balance", 2)],
            Some(BANK_WIT.as_bytes()),
        );
        assert_eq!(
            Value::Object(super::package(&bank).unwrap()),
            json!({
                "::\"miden:bank-account/bank@0.1.0\"::\"get-depositor-balance\"": [
                    { "name": "depositor", "type": "account-id" },
                    { "name": "asset", "type": "asset" },
                ],
            })
        );

        let interface = "miden:deposit-note/miden-deposit-note@0.1.0";
        let note = package(vec![export(interface, "run", 1)], Some(NOTE_WIT.as_bytes()));
        assert_eq!(
            Value::Object(super::package(&note).unwrap()),
            json!({ path(interface, "run"): [{ "name": "arg", "type": "word" }] })
        );
    }

    #[test]
    fn leaves_out_exports_it_cannot_pair() {
        let package = package(
            vec![
                // One parameter short of the WIT's four.
                export(BANK, "withdraw", 3),
                export(BANK, "deposit", 2),
                // Not in the WIT.
                export(BANK, "audit", 0),
                // Another interface, as a transaction script's.
                export("miden:base/transaction-script@1.0.0", "run", 1),
            ],
            Some(BANK_WIT.as_bytes()),
        );
        let parameters = super::package(&package).unwrap();
        assert_eq!(
            parameters.keys().collect::<Vec<_>>(),
            vec![&path(BANK, "deposit")]
        );
    }

    #[test]
    fn no_section_gives_an_empty_map() {
        let package = package(vec![export(BANK, "deposit", 2)], None);
        assert_eq!(super::package(&package), Some(Map::new()));
    }

    #[test]
    fn unreadable_sections_give_none() {
        let not_wit = package(vec![export(BANK, "deposit", 2)], Some(b"not wit"));
        assert_eq!(super::package(&not_wit), None);
        let not_utf8 = package(vec![export(BANK, "deposit", 2)], Some(&[0xff, 0xfe]));
        assert_eq!(super::package(&not_utf8), None);
    }
}
