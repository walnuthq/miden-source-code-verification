//! Reads the versions `builtWith` names from the workspace's lockfile, so the
//! answer can't drift from what the tool was built with.

use std::path::Path;

/// The crates `builtWith` names, in its order.
const CRATES: [&str; 2] = ["miden-assembly", "miden-protocol"];

fn main() {
    let lockfile = Path::new(env!("CARGO_MANIFEST_DIR")).join("../Cargo.lock");
    println!("cargo::rerun-if-changed={}", lockfile.display());
    let lock = std::fs::read_to_string(&lockfile).expect("the workspace's Cargo.lock");
    let built_with = CRATES
        .iter()
        .map(|name| format!("{name} {}", version(&lock, name)))
        .collect::<Vec<_>>()
        .join(", ");
    println!("cargo::rustc-env=MIDEN_ASSEMBLE_BUILT_WITH={built_with}");
}

/// The newest version of `name` in `lock`: the lockfile can hold an older one
/// that another tool's dependency pulls in, and this crate pins the newest.
fn version(lock: &str, name: &str) -> String {
    let header = format!("name = \"{name}\"\nversion = \"");
    lock.match_indices(&header)
        .map(|(start, _)| {
            let rest = &lock[start + header.len()..];
            rest[..rest.find('"').expect("a closing quote")].to_string()
        })
        .max_by(|a, b| numeric(a).cmp(&numeric(b)))
        .unwrap_or_else(|| panic!("{name} is not in Cargo.lock"))
}

fn numeric(version: &str) -> Vec<u64> {
    version
        .split(['.', '-', '+'])
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}
