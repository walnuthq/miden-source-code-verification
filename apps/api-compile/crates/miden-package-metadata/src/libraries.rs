//! The libraries the 0.17 toolchain links a package against, and how an
//! external node in a package's MAST resolves to one of their procedures.

use std::sync::Arc;

use miden_core::mast::{MastForest, MastNodeId};
use miden_core_lib::CoreLibrary;
use miden_mast_package::Word;
use miden_protocol::ProtocolLib;
use miden_standards::StandardsLib;

/// The forests of `miden::core`, `miden::protocol` and `miden::standards`.
pub fn forests() -> Vec<Arc<MastForest>> {
    vec![
        CoreLibrary::default().mast_forest().clone(),
        ProtocolLib::default().mast_forest().clone(),
        StandardsLib::default().package().mast_forest().clone(),
    ]
}

/// The body of the procedure `digest` names, as `(index, node)` into
/// `forests`: the first procedure root with that digest that isn't itself a
/// reference (a re-export is an external node that is also a procedure root).
/// `None` when no forest has it, e.g. a procedure from a user library.
pub fn resolve(forests: &[&MastForest], digest: Word) -> Option<(usize, MastNodeId)> {
    forests.iter().enumerate().find_map(|(index, forest)| {
        forest
            .find_procedure_root(digest)
            .filter(|&id| !forest[id].is_external())
            .map(|id| (index, id))
    })
}
