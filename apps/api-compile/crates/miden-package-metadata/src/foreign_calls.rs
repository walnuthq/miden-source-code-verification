//! Whether each procedure a package exports can make a foreign procedure
//! invocation (FPI), read from its MAST.
//!
//! User code reaches FPI through one protocol procedure,
//! `miden::protocol::tx::execute_foreign_procedure`: the Rust compiler lowers a
//! call on an `#[account(...)]` binding to an `exec` of it. In a package's MAST
//! that is an external node, or a linked-in procedure root, whose digest is
//! the protocol library's export, so the walk matches it by digest before
//! looking at a node's kind. The foreign account and procedure are loaded from
//! locals at the call, so which one is called isn't recoverable: this only
//! says whether one is reachable.
//!
//! A separate walk from `read_only.rs`'s, which returns at the first
//! state-changing procedure and so can't also answer this.

use std::collections::HashSet;
use std::sync::Arc;

use miden_core::mast::{MastForest, MastNode, MastNodeExt, MastNodeId};
use miden_mast_package::{Package, PackageExport, Word};
use miden_protocol::ProtocolLib;

use crate::libraries;

const EXECUTE_FOREIGN_PROCEDURE: &str = "::miden::protocol::tx::execute_foreign_procedure";

pub struct Analyzer {
    // The digest of `tx::execute_foreign_procedure`.
    foreign: Word,
    // The libraries an external procedure is looked up in, after the package.
    libraries: Vec<Arc<MastForest>>,
}

impl Default for Analyzer {
    fn default() -> Self {
        let protocol = ProtocolLib::default();
        let foreign = protocol
            .as_ref()
            .manifest
            .exports()
            .find_map(|export| match export {
                PackageExport::Procedure(procedure)
                    if procedure.path.to_string() == EXECUTE_FOREIGN_PROCEDURE =>
                {
                    Some(procedure.digest)
                }
                _ => None,
            })
            // A protocol bump that renames it must fail the tests, not report
            // `false` for every procedure.
            .unwrap_or_else(|| {
                panic!("the protocol library doesn't export {EXECUTE_FOREIGN_PROCEDURE}")
            });
        Self {
            foreign,
            libraries: libraries::forests(),
        }
    }
}

impl Analyzer {
    /// Each procedure export's answer, by export path: see `procedure`.
    pub fn exports(&self, package: &Package) -> Vec<(String, Option<bool>)> {
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
                let calls = root.and_then(|root| self.procedure(forest, root));
                (procedure.path.to_string(), calls)
            })
            .collect()
    }

    /// Whether a foreign call is reachable from `root`, in `forest` and,
    /// through external nodes, in the libraries: `Some(true)` when one is,
    /// `Some(false)` when none is and everything reachable could be followed,
    /// `None` when none was found but something couldn't be followed (a
    /// dynamic call, or an external procedure from none of the libraries).
    pub fn procedure(&self, forest: &MastForest, root: MastNodeId) -> Option<bool> {
        let forests: Vec<&MastForest> = std::iter::once(forest)
            .chain(self.libraries.iter().map(AsRef::as_ref))
            .collect();
        let mut followed_everything = true;
        let mut seen = HashSet::new();
        let mut stack = vec![(0, root)];
        while let Some((index, id)) = stack.pop() {
            if !seen.insert((index, id)) {
                continue;
            }
            let node = &forests[index][id];
            // Called (an external node) or linked in (a procedure root with
            // the same digest).
            if node.digest() == self.foreign {
                return Some(true);
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
                // Into the kernel, which can't reach a foreign call but
                // through the protocol procedure matched above.
                MastNode::Call(call) if call.is_syscall() => {}
                MastNode::Call(call) => stack.push((index, call.callee())),
                MastNode::Dyn(_) => followed_everything = false,
                MastNode::External(external) => {
                    match libraries::resolve(&forests, external.digest()) {
                        Some(found) => stack.push(found),
                        None => followed_everything = false,
                    }
                }
            }
        }
        followed_everything.then_some(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_standards::code_builder::CodeBuilder;

    /// The answer for each export of an account component built from
    /// `source`, by procedure name.
    fn component(source: &str) -> Vec<(String, Option<bool>)> {
        let package = CodeBuilder::default()
            .compile_component_code("test::component", source)
            .expect("the test component assembles")
            .into_package();
        Analyzer::default()
            .exports(&package)
            .into_iter()
            .map(|(path, calls)| {
                let name = path.rsplit("::").next().unwrap_or(&path).to_string();
                (name, calls)
            })
            .collect()
    }

    fn answer(source: &str, name: &str) -> Option<bool> {
        component(source)
            .into_iter()
            .find_map(|(export, calls)| (export == name).then_some(calls))
            .unwrap_or_else(|| panic!("{name} isn't exported"))
    }

    #[test]
    fn a_foreign_call_is_found() {
        assert_eq!(
            answer(
                "use miden::protocol::tx
                pub proc read_foreign
                    exec.tx::execute_foreign_procedure
                end",
                "read_foreign"
            ),
            Some(true)
        );
    }

    #[test]
    fn a_foreign_call_is_found_through_another_procedure() {
        let source = "use miden::protocol::tx
            proc helper
                exec.tx::execute_foreign_procedure
            end
            pub proc read_foreign
                exec.helper
            end
            pub proc call_helper
                call.helper
            end";
        assert_eq!(answer(source, "read_foreign"), Some(true));
        assert_eq!(answer(source, "call_helper"), Some(true));
    }

    #[test]
    fn reading_storage_makes_no_foreign_call() {
        assert_eq!(
            answer(
                "use miden::protocol::active_account
                pub proc get_count
                    push.0 exec.active_account::get_item
                end",
                "get_count"
            ),
            Some(false)
        );
    }

    #[test]
    fn a_dynamic_call_cant_be_told() {
        assert_eq!(
            answer(
                "pub proc run
                    push.0 dynexec
                end",
                "run"
            ),
            None
        );
    }

    #[test]
    fn a_foreign_call_wins_over_a_dynamic_call() {
        assert_eq!(
            answer(
                "use miden::protocol::tx
                pub proc run
                    push.0 dynexec
                    exec.tx::execute_foreign_procedure
                end",
                "run"
            ),
            Some(true)
        );
    }

    #[test]
    fn a_state_change_doesnt_hide_a_foreign_call() {
        // `read_only.rs`'s walk returns at `incr_nonce`.
        assert_eq!(
            answer(
                "use miden::protocol::native_account
                use miden::protocol::tx
                pub proc copy_count
                    exec.native_account::incr_nonce
                    exec.tx::execute_foreign_procedure
                end",
                "copy_count"
            ),
            Some(true)
        );
    }
}
