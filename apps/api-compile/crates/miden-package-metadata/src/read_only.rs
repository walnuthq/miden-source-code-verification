//! Whether each procedure a package exports can change state, read from its
//! MAST rather than its name.
//!
//! Account state (storage, vault, nonce, code), output notes and the other
//! effects a transaction commits all change through the transaction kernel,
//! which user code reaches through the `miden::protocol` library: its
//! procedures load a kernel procedure's offset and `syscall.exec_kernel_proc`,
//! one dispatcher for all of them. So the kernel side can't tell them apart,
//! and the protocol procedures are where the analysis stops: each one is
//! classified below by name, and the walk treats reaching it as reaching that
//! classification.
//!
//! A procedure is read-only when nothing it can reach is a state-changing
//! protocol procedure, a direct `syscall`, or a dynamic call (whose target is
//! only known at run time), and every external procedure it reaches resolves
//! to one of the libraries the toolchain links against (`miden::core`,
//! `miden::protocol`, `miden::standards`). An external from any other package
//! (a user library) can't be followed, so its caller is unknown.

use std::collections::{HashMap, HashSet};

use miden_core::mast::{MastForest, MastNode, MastNodeExt, MastNodeId};
use miden_core_lib::CoreLibrary;
use miden_mast_package::{Package, PackageExport, Word};
use miden_protocol::ProtocolLib;
use miden_standards::StandardsLib;

const PROTOCOL_PREFIX: &str = "::miden::protocol::";

/// The `miden::protocol` procedures (relative to `miden::protocol`) whose
/// effects only exist once the transaction is submitted: account state,
/// output notes, assets moved out of input notes, minting and burning, the
/// transaction's expiration.
pub const PROTOCOL_STATE_CHANGING: &[&str] = &[
    "active_note::remove_all_assets",
    "active_note::remove_asset",
    "faucet::burn",
    "faucet::mint",
    "input_note::remove_all_assets",
    "input_note::remove_asset",
    "native_account::add_asset",
    "native_account::incr_nonce",
    "native_account::remove_asset",
    "native_account::set_item",
    "native_account::set_map_item",
    "native_account::upgrade",
    "output_note::add_asset",
    "output_note::add_attachment",
    "output_note::add_attachment_from_memory",
    "output_note::add_word_attachment",
    "output_note::create",
    "output_note::seal",
    "tx::update_expiration_block_delta",
];

/// The other `miden::protocol` procedures: they read the transaction's state,
/// or compute from their inputs. `write_*_to_memory` and `asset::store` write
/// to the caller's memory, and `note::compute_and_store_recipient` to the
/// advice map, neither of which outlives the transaction. A foreign procedure
/// can't change the foreign account's state.
///
/// Every procedure the library exports is in one of the two lists (the
/// `protocol_procedures_are_all_classified` test), so a protocol bump that
/// adds one fails the tests until it's classified here.
pub const PROTOCOL_READ_ONLY: &[&str] = &[
    "account_id::eq",
    "account_id::eqz",
    "account_id::shape_suffix",
    "account_id::testz",
    "account_id::validate_structure",
    "active_account::compute_storage_commitment",
    "active_account::get_asset",
    "active_account::get_code_commitment",
    "active_account::get_id",
    "active_account::get_item",
    "active_account::get_map_item",
    "active_account::get_nonce",
    "active_account::get_num_procedures",
    "active_account::get_procedure_root",
    "active_account::get_vault_root",
    "active_account::has_asset",
    "active_account::has_procedure",
    "active_account::has_storage_slot",
    "active_note::find_attachment",
    "active_note::get_asset",
    "active_note::get_attachments_commitment",
    "active_note::get_bounded_storage",
    "active_note::get_initial_assets",
    "active_note::get_initial_assets_info",
    "active_note::get_initial_num_assets",
    "active_note::get_metadata",
    "active_note::get_note_id",
    "active_note::get_recipient",
    "active_note::get_script_root",
    "active_note::get_sender",
    "active_note::get_serial_number",
    "active_note::get_storage",
    "active_note::get_storage_info",
    "active_note::is_private",
    "active_note::is_public",
    "active_note::write_attachment_commitments_to_memory",
    "active_note::write_attachment_to_memory",
    "active_note::write_storage_to_memory",
    "asset::fungible_value_into_amount_unchecked",
    "asset::id_into_asset_class",
    "asset::id_into_composition",
    "asset::id_into_faucet_id",
    "asset::id_to_asset_class",
    "asset::id_to_composition",
    "asset::id_to_faucet_id",
    "asset::load",
    "asset::store",
    "input_note::find_attachment",
    "input_note::find_note",
    "input_note::get_asset",
    "input_note::get_attachments_commitment",
    "input_note::get_initial_assets",
    "input_note::get_initial_assets_info",
    "input_note::get_initial_num_assets",
    "input_note::get_metadata",
    "input_note::get_note_id",
    "input_note::get_recipient",
    "input_note::get_script_root",
    "input_note::get_sender",
    "input_note::get_serial_number",
    "input_note::get_storage_info",
    "input_note::write_attachment_commitments_to_memory",
    "input_note::write_attachment_to_memory",
    "native_account::compute_commitment",
    "native_account::compute_delta_commitment",
    "native_account::get_code_upgrade_commitment",
    "native_account::get_id",
    "native_account::get_initial_asset",
    "native_account::get_initial_commitment",
    "native_account::get_initial_item",
    "native_account::get_initial_map_item",
    "native_account::get_initial_storage_commitment",
    "native_account::get_initial_vault_root",
    "native_account::has_initial_asset",
    "native_account::has_state_changed",
    "native_account::was_procedure_called",
    "note::compute_and_store_recipient",
    "note::compute_recipient",
    "note::compute_storage_commitment",
    "note::find_attachment_idx",
    "note::metadata_into_attachment_schemes",
    "note::metadata_into_note_type",
    "note::metadata_into_sender",
    "note::metadata_into_tag",
    "output_note::compute_note_id",
    "output_note::find_attachment",
    "output_note::get_assets",
    "output_note::get_assets_info",
    "output_note::get_attachments_commitment",
    "output_note::get_metadata",
    "output_note::get_recipient",
    "output_note::is_sealed",
    "output_note::write_attachment_commitments_to_memory",
    "output_note::write_attachment_to_memory",
    "tx::compute_fee",
    "tx::execute_foreign_procedure",
    "tx::get_block_commitment",
    "tx::get_block_timestamp",
    "tx::get_expiration_block_delta",
    "tx::get_fee_asset_id",
    "tx::get_input_notes_commitment",
    "tx::get_num_input_notes",
    "tx::get_num_output_notes",
    "tx::get_output_notes_commitment",
    "tx::get_reference_block_commitment",
    "tx::get_reference_block_number",
    "tx::get_tx_script_root",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    ReadOnly,
    StateChanging,
    Unknown,
}

impl Access {
    /// Of two paths a procedure can take: one that changes state makes it
    /// state-changing, even when another can't be followed.
    fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::StateChanging, _) | (_, Self::StateChanging) => Self::StateChanging,
            (Self::Unknown, _) | (_, Self::Unknown) => Self::Unknown,
            _ => Self::ReadOnly,
        }
    }

    /// `true`, `false`, or `null` when it can't be told.
    pub fn read_only(self) -> Option<bool> {
        match self {
            Self::ReadOnly => Some(true),
            Self::StateChanging => Some(false),
            Self::Unknown => None,
        }
    }
}

/// The protocol procedures' classification, by procedure root. A protocol
/// procedure in neither list counts as unknown.
pub fn protocol_access(protocol: &Package) -> HashMap<Word, Access> {
    protocol
        .manifest
        .exports()
        .filter_map(|export| match export {
            PackageExport::Procedure(procedure) => Some(procedure),
            _ => None,
        })
        .map(|procedure| {
            let path = procedure.path.to_string();
            let name = path.strip_prefix(PROTOCOL_PREFIX).unwrap_or(&path);
            let access = if PROTOCOL_STATE_CHANGING.contains(&name) {
                Access::StateChanging
            } else if PROTOCOL_READ_ONLY.contains(&name) {
                Access::ReadOnly
            } else {
                Access::Unknown
            };
            (procedure.digest, access)
        })
        .collect()
}

pub struct Analyzer {
    protocol: HashMap<Word, Access>,
    // The libraries an external procedure is looked up in, after the package.
    libraries: Vec<std::sync::Arc<MastForest>>,
}

impl Default for Analyzer {
    fn default() -> Self {
        let protocol = ProtocolLib::default();
        Self {
            protocol: protocol_access(protocol.as_ref()),
            libraries: vec![
                CoreLibrary::default().mast_forest().clone(),
                protocol.mast_forest().clone(),
                StandardsLib::default().package().mast_forest().clone(),
            ],
        }
    }
}

impl Analyzer {
    /// Each procedure export's access, by export path.
    pub fn exports(&self, package: &Package) -> Vec<(String, Access)> {
        let forest = package.mast_forest();
        package
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure),
                _ => None,
            })
            .map(|procedure| {
                let root = procedure
                    .node
                    .or_else(|| forest.find_procedure_root(procedure.digest));
                let access = root.map_or(Access::Unknown, |root| self.procedure(forest, root));
                (procedure.path.to_string(), access)
            })
            .collect()
    }

    /// Everything reachable from `root`, in `forest` and, through external
    /// nodes, in the libraries.
    pub fn procedure(&self, forest: &MastForest, root: MastNodeId) -> Access {
        let forests: Vec<&MastForest> = std::iter::once(forest)
            .chain(self.libraries.iter().map(AsRef::as_ref))
            .collect();
        let mut access = Access::ReadOnly;
        let mut seen = HashSet::new();
        let mut stack = vec![(0, root)];
        while let Some((index, id)) = stack.pop() {
            if !seen.insert((index, id)) {
                continue;
            }
            let node = &forests[index][id];
            // A protocol procedure, called (an external node) or linked in (a
            // procedure root with the same digest): its classification stands
            // for its body.
            if let Some(&protocol_access) = self.protocol.get(&node.digest()) {
                access = access.join(protocol_access);
                if access == Access::StateChanging {
                    return access;
                }
                continue;
            }
            match node {
                MastNode::Block(_) => {}
                MastNode::Join(join) => {
                    stack.extend([(index, join.first()), (index, join.second())])
                }
                MastNode::Split(split) => {
                    stack.extend([(index, split.on_true()), (index, split.on_false())])
                }
                MastNode::Loop(body) => stack.push((index, body.body())),
                // Straight into the kernel, past the protocol library.
                MastNode::Call(call) if call.is_syscall() => access = access.join(Access::Unknown),
                MastNode::Call(call) => stack.push((index, call.callee())),
                MastNode::Dyn(_) => access = access.join(Access::Unknown),
                MastNode::External(external) => {
                    let digest = external.digest();
                    // Its body: a procedure root with that digest that isn't
                    // itself a reference (a re-export is an external node
                    // that is also a procedure root).
                    match forests.iter().enumerate().find_map(|(index, forest)| {
                        forest
                            .find_procedure_root(digest)
                            .filter(|&id| !forest[id].is_external())
                            .map(|id| (index, id))
                    }) {
                        Some(found) => stack.push(found),
                        None => access = access.join(Access::Unknown),
                    }
                }
            }
        }
        access
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standards_access(path: &str) -> Access {
        let standards = StandardsLib::default().package();
        Analyzer::default()
            .exports(&standards)
            .into_iter()
            .find_map(|(export, access)| (export == path).then_some(access))
            .unwrap_or_else(|| panic!("{path} isn't exported"))
    }

    #[test]
    fn getters_are_read_only() {
        assert_eq!(
            standards_access("::miden::standards::access::ownable2step::get_owner"),
            Access::ReadOnly
        );
        assert_eq!(
            standards_access(
                "::miden::standards::assets::fungible_asset::get_active_account_balance"
            ),
            Access::ReadOnly
        );
    }

    #[test]
    fn state_changes_are_found_through_libraries() {
        // Adds the asset to the vault, through `native_account::add_asset`.
        assert_eq!(
            standards_access("::miden::standards::wallets::basic::receive_asset"),
            Access::StateChanging
        );
        // Creates an output note.
        assert_eq!(
            standards_access("::miden::standards::wallets::basic::create_note"),
            Access::StateChanging
        );
    }

    #[test]
    fn dynamic_calls_are_unknown() {
        // Runs the faucet's mint policy, a procedure picked at run time.
        assert_eq!(
            standards_access(
                "::miden::standards::faucets::policies::policy_manager::execute_mint_policy"
            ),
            Access::Unknown
        );
    }

    #[test]
    fn protocol_procedures_are_all_classified() {
        let protocol = ProtocolLib::default();
        let unclassified: Vec<_> = protocol
            .as_ref()
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure.path.to_string()),
                _ => None,
            })
            .filter(|path| {
                let name = path.strip_prefix(PROTOCOL_PREFIX).unwrap_or(path);
                !PROTOCOL_STATE_CHANGING.contains(&name) && !PROTOCOL_READ_ONLY.contains(&name)
            })
            .collect();
        assert!(
            unclassified.is_empty(),
            "unclassified protocol procedures: {unclassified:?}"
        );
    }

    #[test]
    fn classified_procedures_all_exist() {
        let protocol = ProtocolLib::default();
        let exported: HashSet<_> = protocol
            .as_ref()
            .manifest
            .exports()
            .filter_map(|export| match export {
                PackageExport::Procedure(procedure) => Some(procedure.path.to_string()),
                _ => None,
            })
            .collect();
        let listed: Vec<_> = PROTOCOL_STATE_CHANGING
            .iter()
            .chain(PROTOCOL_READ_ONLY)
            .collect();
        let missing: Vec<_> = listed
            .iter()
            .filter(|name| !exported.contains(&format!("{PROTOCOL_PREFIX}{name}")))
            .collect();
        assert!(missing.is_empty(), "listed but not exported: {missing:?}");
        assert_eq!(
            listed.len(),
            listed.iter().collect::<HashSet<_>>().len(),
            "a protocol procedure is listed twice"
        );
    }
}
