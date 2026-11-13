//! The schemas a package embeds for the data it is given: an account
//! component's storage slots and a note's storage (its inputs).
//!
//! Both are optional in the tool's output. A package without the section has no
//! key; a section that fails to parse is reported on stderr and has no key
//! either, so a schema the tool can't read never fails a build.

use miden_mast_package::{Package, SectionId};
use miden_note_schema::{NoteStorageSchema, PrimitiveType, SchemaType, SchemaTypeKind};
use miden_protocol::account::component::{AccountComponentMetadata, StorageSlotSchema, WordSchema};
use miden_serde_utils::Deserializable;
use serde_json::{Map, Value, json};

/// The id of the section `cargo-miden` writes a note's storage schema to:
/// `PACKAGE_NOTE_STORAGE_SCHEMA_SECTION_ID` in `midenc-frontend-wasm-metadata`.
const NOTE_STORAGE_SCHEMA_SECTION: &str = "note_storage_schema";

/// The account component's storage slots, in the order of its metadata, or
/// `None` when the package has no account component metadata.
pub fn storage(package: &Package) -> Option<Value> {
    let bytes = section(package, &SectionId::ACCOUNT_COMPONENT_METADATA)?;
    let metadata = AccountComponentMetadata::read_from_bytes(bytes)
        .inspect_err(|error| eprintln!("failed to read the account component metadata: {error}"))
        .ok()?;
    let slots = metadata
        .storage_schema()
        .iter()
        .map(|(name, slot)| {
            let mut entry = Map::new();
            entry.insert("name".into(), json!(name.as_str()));
            let description = match slot {
                StorageSlotSchema::Value(value) => value.description(),
                StorageSlotSchema::Map(map) => map.description(),
            };
            if let Some(description) = description {
                entry.insert("description".into(), json!(description));
            }
            match slot {
                StorageSlotSchema::Value(value) => {
                    entry.insert("type".into(), json!("value"));
                    entry.insert("valueType".into(), json!(value.word().word_type().as_str()));
                    if let WordSchema::Simple {
                        default_value: Some(default),
                        ..
                    } = value.word()
                    {
                        entry.insert("defaultValue".into(), json!(default.to_hex()));
                    }
                }
                StorageSlotSchema::Map(map) => {
                    entry.insert("type".into(), json!("map"));
                    entry.insert(
                        "keyType".into(),
                        json!(map.key_schema().word_type().as_str()),
                    );
                    entry.insert(
                        "valueType".into(),
                        json!(map.value_schema().word_type().as_str()),
                    );
                }
            }
            Value::Object(entry)
        })
        .collect::<Vec<_>>();
    Some(json!({ "slots": slots }))
}

/// The note's storage: the root record's fields in declaration order, which is
/// the order their felts take in the note's storage. `None` when the package
/// has no note storage schema.
pub fn note_storage(package: &Package) -> Option<Value> {
    let id = SectionId::custom(NOTE_STORAGE_SCHEMA_SECTION).expect("a valid section id");
    section(package, &id)?;
    let schema = NoteStorageSchema::from_package(package)
        .inspect_err(|error| eprintln!("failed to read the note storage schema: {error}"))
        .ok()?;
    let root = schema.root();
    let SchemaTypeKind::Record(fields) = root.kind() else {
        unreachable!("`NoteStorageSchema` checks that the root is a record")
    };
    let fields = fields
        .iter()
        .map(|field| {
            let mut entry = Map::new();
            entry.insert("name".into(), json!(field.name()));
            entry.insert("type".into(), json!(type_name(field.ty())));
            // The felts the field takes in the note's storage, absent when its
            // width varies (an `option` or a `variant`).
            if let Some(width) = field.ty().layout().fixed_width() {
                entry.insert("width".into(), json!(width));
            }
            if let Some(docs) = field.docs() {
                entry.insert("description".into(), json!(docs.trim()));
            }
            Value::Object(entry)
        })
        .collect::<Vec<_>>();
    Some(json!({ "name": root.name(), "fields": fields }))
}

/// The package's section with `id`, or `None` when it has none.
fn section<'a>(package: &'a Package, id: &SectionId) -> Option<&'a [u8]> {
    package
        .sections
        .iter()
        .find(|section| section.id == *id)
        .map(|section| section.data.as_ref())
}

/// A type as the WIT names it (`felt`, `account-id`, `asset`, or a record the
/// note defines), or its structural kind when it has no name.
fn type_name(ty: &SchemaType) -> &str {
    if let Some(name) = ty.name() {
        return name;
    }
    match ty.kind() {
        SchemaTypeKind::Felt => "felt",
        SchemaTypeKind::Primitive(PrimitiveType::U64) => "u64",
        SchemaTypeKind::Primitive(PrimitiveType::U32) => "u32",
        SchemaTypeKind::Primitive(PrimitiveType::U8) => "u8",
        SchemaTypeKind::Primitive(PrimitiveType::Bool) => "bool",
        SchemaTypeKind::Record(_) => "record",
        SchemaTypeKind::Option(_) => "option",
        SchemaTypeKind::Variant(_) => "variant",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_mast_package::Section;
    use miden_protocol::account::StorageSlotName;
    use miden_protocol::account::component::{SchemaType as SlotType, StorageSchema};
    use miden_serde_utils::Serializable;
    use miden_standards::StandardsLib;

    const P2ID_SCHEMA: &str = r#"package miden:p2id-schema@0.1.0;

use miden:base/core-types@1.0.0;

interface note-storage {
    use core-types.{account-id};

    record p2id-note {
        /// The account that may consume the note.
        target-account-id: account-id,
        amount: u64,
        tag: option<u32>,
    }

    type storage = p2id-note;
}

package miden:base@1.0.0 {
    interface core-types {
        record felt { inner: f32 }
        record account-id { prefix: felt, suffix: felt }
    }
}
"#;

    /// A package with `sections` and nothing else of interest.
    fn package(sections: Vec<Section>) -> Package {
        let mut package = Package::clone(&StandardsLib::default().package());
        package.sections = sections;
        package
    }

    #[test]
    fn no_sections_give_no_schemas() {
        let package = package(vec![]);
        assert_eq!(storage(&package), None);
        assert_eq!(note_storage(&package), None);
    }

    #[test]
    fn storage_lists_value_and_map_slots() {
        let schema = StorageSchema::new([
            (
                StorageSlotName::new("test::count").unwrap(),
                StorageSlotSchema::value("a counter", SlotType::native_felt()),
            ),
            (
                StorageSlotName::new("test::balances").unwrap(),
                StorageSlotSchema::map(
                    "balances",
                    SlotType::native_word(),
                    SlotType::native_felt(),
                ),
            ),
        ])
        .unwrap();
        let metadata = AccountComponentMetadata::new("test").with_storage_schema(schema);
        let package = package(vec![Section::new(
            SectionId::ACCOUNT_COMPONENT_METADATA,
            metadata.to_bytes(),
        )]);
        let mut slots = storage(&package).unwrap()["slots"]
            .as_array()
            .unwrap()
            .clone();
        slots.sort_by_key(|slot| slot["name"].as_str().unwrap().to_owned());
        assert_eq!(
            slots,
            vec![
                json!({ "name": "test::balances", "description": "balances", "type": "map", "keyType": "word", "valueType": "felt" }),
                json!({ "name": "test::count", "description": "a counter", "type": "value", "valueType": "felt" }),
            ]
        );
    }

    #[test]
    fn note_storage_lists_the_root_record_fields() {
        let package = package(vec![Section::new(
            SectionId::custom(NOTE_STORAGE_SCHEMA_SECTION).unwrap(),
            P2ID_SCHEMA.as_bytes().to_vec(),
        )]);
        assert_eq!(
            note_storage(&package),
            Some(json!({
                "name": "p2id-note",
                "fields": [
                    { "name": "target-account-id", "type": "account-id", "width": 2, "description": "The account that may consume the note." },
                    { "name": "amount", "type": "u64", "width": 2 },
                    { "name": "tag", "type": "option" },
                ],
            }))
        );
    }

    #[test]
    fn unreadable_sections_give_no_schemas() {
        let package = package(vec![
            Section::new(SectionId::ACCOUNT_COMPONENT_METADATA, vec![1, 2, 3]),
            Section::new(
                SectionId::custom(NOTE_STORAGE_SCHEMA_SECTION).unwrap(),
                b"not wit".to_vec(),
            ),
        ]);
        assert_eq!(storage(&package), None);
        assert_eq!(note_storage(&package), None);
    }
}
