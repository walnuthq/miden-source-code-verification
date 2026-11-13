//! The account procedures a note or transaction script calls, read from its
//! MAST: what an account's code must have for the script to run against it.
//!
//! A script runs outside the account's context and reaches the account with
//! `call`, which switches context: an account procedure is the callee of a
//! `call` that isn't a `syscall`. The walk records its digest and stops
//! there, since its body runs in the account. A `syscall` reaches the kernel,
//! not the account. An `exec` stays in the script's context, so the walk
//! follows it, into the core, protocol and standards libraries too: a library
//! procedure can `call` the account itself (the standards P2ID script calls
//! the basic wallet's `receive_asset` from a library wrapper). An `exec` of a
//! procedure from any other library can't be followed, and is skipped: being
//! an `exec`, it doesn't switch to the account's context. A dynamic call
//! (`dynexec` or `dyncall`) targets a procedure only known at run time, so
//! the answer is `None`: the calls can't be told. So is an entry procedure
//! whose body isn't in the package's forest.

use std::collections::HashSet;

use miden_assembly_syntax::ast::Attribute;
use miden_core::mast::{MastForest, MastNode, MastNodeExt, MastNodeId};
use miden_mast_package::{Package, PackageExport, Word};

use crate::libraries;

/// The attributes the toolchain marks a script's entry procedure with.
const ENTRY_MARKERS: &[&str] = &["note_script", "transaction_script"];

/// The account procedures `package`'s entry procedures call, sorted by hex
/// and deduplicated, or `None` when they can't be told. The entries are the
/// procedure exports marked `note_script` or `transaction_script`, or every
/// procedure export when none is.
pub fn package(package: &Package) -> Option<Vec<Word>> {
    let forest = package.mast_forest();
    let procedures: Vec<_> = package
        .manifest
        .exports()
        .filter_map(|export| match export {
            PackageExport::Procedure(procedure) => Some(procedure),
            _ => None,
        })
        .collect();
    let marked: Vec<_> = procedures
        .iter()
        .filter(|procedure| {
            procedure.attributes.iter().any(|attribute| {
                matches!(attribute, Attribute::Marker(name) if ENTRY_MARKERS.contains(&name.as_str()))
            })
        })
        .collect();
    let entries = if marked.is_empty() {
        procedures.iter().collect()
    } else {
        marked
    };
    let roots = entries
        .into_iter()
        .map(|procedure| {
            procedure
                .node
                .or_else(|| forest.find_procedure_root(procedure.digest))
        })
        .collect::<Option<Vec<_>>>()?;
    calls(forest, &roots)
}

/// The account procedures reachable from `roots` in `forest`: see the module
/// documentation.
pub fn calls(forest: &MastForest, roots: &[MastNodeId]) -> Option<Vec<Word>> {
    let libraries = libraries::forests();
    let forests: Vec<&MastForest> = std::iter::once(forest)
        .chain(libraries.iter().map(AsRef::as_ref))
        .collect();
    let mut called = Vec::new();
    let mut seen = HashSet::new();
    let mut stack: Vec<_> = roots.iter().map(|&root| (0, root)).collect();
    while let Some((index, id)) = stack.pop() {
        if !seen.insert((index, id)) {
            continue;
        }
        match &forests[index][id] {
            MastNode::Block(_) => {}
            MastNode::Join(join) => stack.extend([(index, join.first()), (index, join.second())]),
            MastNode::Split(split) => {
                stack.extend([(index, split.on_true()), (index, split.on_false())])
            }
            MastNode::Loop(body) => stack.push((index, body.body())),
            MastNode::Call(call) if call.is_syscall() => {}
            MastNode::Call(call) => {
                let callee = &forests[index][call.callee()];
                let digest = callee.digest();
                // The script's own code, called rather than executed: follow
                // it. The toolchain doesn't emit this; it calls its
                // dependencies' procedures through external nodes. A library
                // procedure linked into the package isn't the script's own,
                // since an account can export it (the basic wallet does).
                if index == 0
                    && !callee.is_external()
                    && libraries::resolve(&forests[1..], digest).is_none()
                {
                    stack.push((0, call.callee()));
                } else {
                    called.push(digest);
                }
            }
            MastNode::Dyn(_) => return None,
            MastNode::External(external) => {
                if let Some(found) = libraries::resolve(&forests, external.digest()) {
                    stack.push(found);
                }
            }
        }
    }
    called.sort_by_key(Word::to_hex);
    called.dedup();
    Some(called)
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_standards::StandardsLib;
    use miden_standards::code_builder::CodeBuilder;
    use miden_standards::note::P2idNote;

    fn standards_digest(path: &str) -> Word {
        StandardsLib::default()
            .package()
            .manifest
            .exports()
            .find_map(|export| match export {
                PackageExport::Procedure(procedure) if procedure.path.to_string() == path => {
                    Some(procedure.digest)
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("{path} isn't exported"))
    }

    fn tx_script_calls(source: &str) -> Option<Vec<Word>> {
        let script = CodeBuilder::default()
            .compile_tx_script(source)
            .expect("the test script assembles");
        calls(&script.mast(), &[script.entrypoint()])
    }

    #[test]
    fn p2id_calls_receive_asset() {
        let script = P2idNote::script();
        assert_eq!(
            calls(&script.mast(), &[script.entrypoint()]),
            Some(vec![standards_digest(
                "::miden::standards::wallets::basic::receive_asset"
            )])
        );
    }

    #[test]
    fn execs_alone_call_nothing() {
        assert_eq!(
            tx_script_calls(
                "use miden::core::math::u64
                @transaction_script
                pub proc main
                    push.1.2.3.4 exec.u64::wrapping_add dropw
                end"
            ),
            Some(vec![])
        );
    }

    #[test]
    fn dynamic_calls_cant_be_told() {
        for instruction in ["dynexec", "dyncall"] {
            assert_eq!(
                tx_script_calls(&format!(
                    "@transaction_script
                    pub proc main
                        push.0 {instruction}
                    end"
                )),
                None,
                "{instruction}"
            );
        }
    }

    #[test]
    fn calls_are_deduplicated_and_sorted() {
        let calls = tx_script_calls(
            "use miden::standards::wallets::basic
            @transaction_script
            pub proc main
                call.basic::receive_asset
                call.basic::move_asset_to_note
                call.basic::receive_asset
            end",
        )
        .expect("no dynamic call");
        let mut expected = vec![
            standards_digest("::miden::standards::wallets::basic::receive_asset"),
            standards_digest("::miden::standards::wallets::basic::move_asset_to_note"),
        ];
        expected.sort_by_key(Word::to_hex);
        assert_eq!(calls, expected);
    }

    #[test]
    fn syscalls_are_not_account_procedures() {
        // `get_id` reaches the kernel through `syscall`.
        assert_eq!(
            tx_script_calls(
                "use miden::protocol::active_account
                @transaction_script
                pub proc main
                    exec.active_account::get_id drop drop
                end"
            ),
            Some(vec![])
        );
    }
}
