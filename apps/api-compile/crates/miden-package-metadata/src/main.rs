use anyhow::{Context, Result};
use clap::Parser;
use miden_assembly_syntax::ast::types::{
    AddressSpace, CallConv, EnumRef, FunctionType, RecTypeRef, StructRef, Type, TypeRepr,
};
use miden_assembly_syntax::ast::{
    Attribute, AttributeSet, ConstantValue, HashKind, MetaExpr, MetaKeyValue, MetaList,
};
use miden_assembly_syntax::parser::{IntValue, WordValue};
use miden_mast_package::{Dependency, Package, PackageExport, Word};
use miden_serde_utils::Deserializable;
use serde_json::{Map, Value, json};
use std::path::PathBuf;

/// Extracts and prints metadata from a Miden package (.masp) file as JSON.
#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Path to the .masp file
    masp_path: PathBuf,
}

// The JSON below is the contract `packages/utils/src/manifest.ts` documents.
// Up to `miden-mast-package` 0.29 it was simply the serde derive output of the
// manifest types; from 0.35 those types no longer derive `serde`, so it is
// written out here, keeping the shape the derives produced: externally tagged
// enums, struct fields in declaration order, `Option`s as `null`.

fn main() -> Result<()> {
    let args = Args::parse();

    let bytes = std::fs::read(&args.masp_path)
        .with_context(|| format!("failed to read '{}'", args.masp_path.display()))?;

    let package = Package::read_from_bytes(&bytes).with_context(|| {
        format!(
            "failed to parse package from '{}'",
            args.masp_path.display()
        )
    })?;

    let metadata = json!({
        // The digest of the package's MAST forest, which is what `digest()`
        // returned before 0.35 — not `commitment()`, which also binds the
        // manifest and every other section.
        "digest": package.mast_forest_commitment().to_hex(),
        // Serialized by its canonical name, e.g. `account-component`.
        "kind": package.kind.as_str(),
        "manifest": {
            "exports": package.manifest.exports().map(export).collect::<Result<Vec<_>>>()?,
            "dependencies": package.manifest.dependencies().map(dependency).collect::<Vec<_>>(),
        },
    });

    println!("{}", serde_json::to_string(&metadata)?);

    Ok(())
}

fn word(word: &Word) -> Value {
    json!(word.to_hex())
}

fn export(export: &PackageExport) -> Result<Value> {
    Ok(match export {
        PackageExport::Procedure(procedure) => json!({ "Procedure": {
            "path": procedure.path.to_string(),
            "node": procedure.node.map(u32::from),
            "source_node": procedure.source_node.map(u32::from),
            "digest": word(&procedure.digest),
            "signature": procedure.signature.as_ref().map(function_type).transpose()?,
            "attributes": attribute_set(&procedure.attributes),
        }}),
        PackageExport::Constant(constant) => json!({ "Constant": {
            "path": constant.path.to_string(),
            "value": constant_value(&constant.value),
        }}),
        PackageExport::Type(ty) => json!({ "Type": {
            "path": ty.path.to_string(),
            "ty": TypeWriter::default().ty(&ty.ty)?,
        }}),
    })
}

fn dependency(dependency: &Dependency) -> Value {
    json!({
        "name": dependency.name.to_string(),
        "kind": dependency.kind.as_str(),
        "version": dependency.version.to_string(),
        "digest": word(&dependency.digest),
    })
}

// ─── miden-assembly-syntax ──────────────────────────────────────────────────

fn int_value(value: &IntValue) -> Value {
    match value {
        IntValue::U8(value) => json!(value),
        IntValue::U16(value) => json!(value),
        IntValue::U32(value) => json!(value),
        IntValue::Felt(value) => json!(value.as_canonical_u64()),
    }
}

fn word_value(value: &WordValue) -> Value {
    json!(value.0.map(|felt| felt.as_canonical_u64()))
}

fn hash_kind(kind: &HashKind) -> &'static str {
    match kind {
        HashKind::Word => "Word",
        HashKind::Event => "Event",
    }
}

fn constant_value(value: &ConstantValue) -> Value {
    match value {
        ConstantValue::Int(value) => json!({ "Int": int_value(value) }),
        ConstantValue::String(value) => json!({ "String": value.as_str() }),
        ConstantValue::Word(value) => json!({ "Word": word_value(value) }),
        ConstantValue::Hash(kind, value) => json!({ "Hash": [hash_kind(kind), value.as_str()] }),
    }
}

fn meta_expr(expr: &MetaExpr) -> Value {
    match expr {
        MetaExpr::Ident(ident) => json!({ "ident": ident.as_str() }),
        MetaExpr::Int(value) => json!({ "int": int_value(value) }),
        MetaExpr::Word(value) => json!({ "word": word_value(value) }),
        MetaExpr::String(value) => json!({ "string": value.as_str() }),
    }
}

fn attribute_set(attributes: &AttributeSet) -> Value {
    let attrs: Vec<_> = attributes
        .iter()
        .map(|attribute| match attribute {
            Attribute::Marker(name) => json!({ "Marker": name.as_str() }),
            Attribute::List(MetaList { name, items, .. }) => json!({ "List": {
                "name": name.as_str(),
                "items": items.iter().map(meta_expr).collect::<Vec<_>>(),
            }}),
            Attribute::KeyValue(MetaKeyValue { name, items, .. }) => json!({ "KeyValue": {
                "name": name.as_str(),
                "items": items
                    .iter()
                    .map(|(key, value)| (key.as_str().to_string(), meta_expr(value)))
                    .collect::<Map<_, _>>(),
            }}),
        })
        .collect();
    json!({ "attrs": attrs })
}

// ─── midenc-hir-type ────────────────────────────────────────────────────────

fn function_type(ty: &FunctionType) -> Result<Value> {
    TypeWriter::default().function(ty)
}

/// Writes a [Type], which since `midenc-hir-type` 0.17 may be recursive.
///
/// A recursive struct or enum is a [RecTypeRef] that unfolds one level at a
/// time, so following it naively would never end. Each one is written out in
/// full the first time it is reached, and as `{ "Rec": name }` wherever it
/// recurs inside its own definition.
#[derive(Default)]
struct TypeWriter {
    unfolding: Vec<RecTypeRef>,
}

impl TypeWriter {
    fn ty(&mut self, ty: &Type) -> Result<Value> {
        Ok(match ty {
            Type::Unknown => json!("Unknown"),
            Type::Never => json!("Never"),
            Type::Variadic => json!("Variadic"),
            Type::I1 => json!("I1"),
            Type::I8 => json!("I8"),
            Type::U8 => json!("U8"),
            Type::I16 => json!("I16"),
            Type::U16 => json!("U16"),
            Type::I32 => json!("I32"),
            Type::U32 => json!("U32"),
            Type::I64 => json!("I64"),
            Type::U64 => json!("U64"),
            Type::I128 => json!("I128"),
            Type::U128 => json!("U128"),
            Type::U256 => json!("U256"),
            Type::F64 => json!("F64"),
            Type::Felt => json!("Felt"),
            Type::Ptr(pointer) => json!({ "Ptr": {
                "addrspace": match pointer.addrspace {
                    AddressSpace::Byte => "Byte",
                    AddressSpace::Element => "Element",
                },
                "pointee": self.ty(&pointer.pointee)?,
            }}),
            Type::Struct(StructRef::Plain(_)) | Type::Enum(EnumRef::Plain(_)) => {
                self.aggregate(ty)?
            }
            Type::Struct(StructRef::Rec(rec)) | Type::Enum(EnumRef::Rec(rec)) => {
                if self.unfolding.contains(rec) {
                    json!({ "Rec": rec.name().as_deref() })
                } else {
                    self.unfolding.push(rec.clone());
                    let value = self.aggregate(ty);
                    self.unfolding.pop();
                    value?
                }
            }
            Type::Array(array) => json!({ "Array": {
                "ty": self.ty(&array.ty)?,
                "len": array.len,
            }}),
            Type::List(element) => json!({ "List": self.ty(element)? }),
            Type::Function(function) => json!({ "Function": self.function(function)? }),
        })
    }

    fn aggregate(&mut self, ty: &Type) -> Result<Value> {
        Ok(match ty {
            Type::Struct(struct_ref) => {
                let struct_ty = struct_ref.get();
                let fields = struct_ty
                    .fields()
                    .iter()
                    .map(|field| {
                        Ok(json!({
                            "name": field.name.as_deref(),
                            "index": field.index,
                            "align": field.align,
                            "offset": field.offset,
                            "ty": self.ty(&field.ty)?,
                        }))
                    })
                    .collect::<Result<Vec<_>>>()?;
                json!({ "Struct": {
                    "name": struct_ty.name().as_deref(),
                    "repr": match struct_ty.repr() {
                        TypeRepr::Default => json!("Default"),
                        TypeRepr::Align(align) => json!({ "Align": align.get() }),
                        TypeRepr::Packed(align) => json!({ "Packed": align.get() }),
                        TypeRepr::Transparent => json!("Transparent"),
                    },
                    "size": struct_ty.size(),
                    "fields": fields,
                }})
            }
            Type::Enum(enum_ref) => {
                let enum_ty = enum_ref.get();
                let variants = enum_ty
                    .variants()
                    .iter()
                    .map(|variant| {
                        let discriminant_value = variant
                            .discriminant_value
                            .map(u64::try_from)
                            .transpose()
                            .with_context(|| {
                                format!("discriminant of '{}' does not fit in a u64", variant.name)
                            })?;
                        Ok(json!({
                            "name": &*variant.name,
                            "discriminant_value": discriminant_value,
                            "value": variant.value.as_ref().map(|value| self.ty(value)).transpose()?,
                        }))
                    })
                    .collect::<Result<Vec<_>>>()?;
                json!({ "Enum": {
                    "name": &**enum_ty.name(),
                    "discriminant": self.ty(enum_ty.discriminant())?,
                    "variants": variants,
                    "offsets": enum_ty.variant_offsets().map(|(offset, _)| offset).collect::<Vec<_>>(),
                    "size": enum_ty.size_in_bytes(),
                    "align": enum_ty.min_alignment(),
                }})
            }
            _ => unreachable!("only called on structs and enums"),
        })
    }

    fn function(&mut self, function: &FunctionType) -> Result<Value> {
        let params = function
            .params
            .iter()
            .map(|param| self.ty(param))
            .collect::<Result<Vec<_>>>()?;
        let results = function
            .results
            .iter()
            .map(|result| self.ty(result))
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({
            // The four conventions predating `Extern` by discriminant, as
            // `serde_repr` wrote them; `Extern` carries a name, so it is tagged.
            "abi": match &function.abi {
                CallConv::Fast => json!(0),
                CallConv::C => json!(1),
                CallConv::Wasm => json!(2),
                CallConv::ComponentModel => json!(3),
                CallConv::Extern(name) => json!({ "Extern": &**name }),
            },
            "params": params,
            "results": results,
        }))
    }
}
