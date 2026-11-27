//! Runs the binary on the projects in `tests/projects`: a counter account
//! component, a note and a transaction script that call it, an account
//! component that makes a foreign procedure invocation, and a workspace whose
//! member re-exports the standard wallet's procedures.

use miden_mast_package::Package;
use miden_serde_utils::Deserializable;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

const PROJECTS: [&str; 5] = [
    "counter-account",
    "increment-note",
    "increment-script",
    "fpi-account",
    "wallets/basic",
];

/// A fresh copy of `tests/projects`, as `<dir>/projects`, in its own
/// directory: the tests run in parallel and some change the copy.
struct Copy {
    dir: PathBuf,
}

impl Copy {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "miden-assemble-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        copy_dir(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/projects"),
            &dir.join("projects"),
        );
        Self { dir }
    }

    fn root(&self) -> PathBuf {
        self.dir.join("projects")
    }

    /// Replaces `from` with `to` in `file`, relative to the project
    /// directory.
    fn edit(&self, file: &str, from: &str, to: &str) {
        let path = self.root().join(file);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(from), "{from} is not in {file}");
        std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    }

    /// Assembles `entrypoint`, returning the tool's output and the package it
    /// wrote, if any.
    fn assemble(&self, entrypoint: &str) -> (Value, Option<Vec<u8>>) {
        let out = self.dir.join(format!("{entrypoint}.masp"));
        let _ = std::fs::remove_file(&out);
        let output = Command::new(env!("CARGO_BIN_EXE_miden-assemble"))
            .arg(self.root())
            .arg(entrypoint)
            .arg(&out)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let json = serde_json::from_slice(&output.stdout).unwrap();
        (json, std::fs::read(&out).ok())
    }
}

impl Drop for Copy {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn commitment(bytes: &[u8]) -> String {
    Package::read_from_bytes(bytes)
        .unwrap()
        .dependency_commitment()
        .to_hex()
}

#[test]
fn builds_every_project() {
    let copy = Copy::new();
    for project in PROJECTS {
        let (output, package) = copy.assemble(project);
        assert_eq!(output["built"], true, "{project}: {output}");
        assert_eq!(output["diagnostics"], json!([]), "{project}");
        assert_eq!(output["rendered"], "", "{project}");
        let built_with = output["builtWith"].as_str().unwrap();
        assert!(
            built_with.starts_with("miden-assembly 0.36."),
            "{built_with}"
        );
        assert!(
            built_with.contains(", miden-protocol 0.18."),
            "{built_with}"
        );
        let package = Package::read_from_bytes(&package.unwrap()).unwrap();
        // The dev profile keeps the debug info.
        assert!(
            package
                .sections
                .iter()
                .any(|section| section.id.as_str() == "debug_info"),
            "{project}"
        );
    }
}

#[test]
fn builds_are_reproducible() {
    let copy = Copy::new();
    let (_, first) = copy.assemble("increment-note");
    let (_, second) = copy.assemble("increment-note");
    assert_eq!(first.unwrap(), second.unwrap());
}

#[test]
fn the_package_does_not_depend_on_the_directory() {
    let (one, other) = (Copy::new(), Copy::new());
    for project in PROJECTS {
        let (_, first) = one.assemble(project);
        let (_, second) = other.assemble(project);
        let (first, second) = (first.unwrap(), second.unwrap());
        assert_eq!(commitment(&first), commitment(&second), "{project}");
        // The debug info names the sources relative to the project root, so
        // the bytes are the same too.
        assert!(first == second, "{project}: the packages differ");
    }
}

#[test]
fn the_debug_info_names_sources_by_their_path_in_the_project() {
    let copy = Copy::new();
    let root = copy.root();
    // The note's own source, and none under the project root by its full path.
    let (_, package) = copy.assemble("increment-note");
    let package = Package::read_from_bytes(&package.unwrap()).unwrap();
    let debug_info = package.debug_info().unwrap().unwrap();
    let paths = debug_info
        .files()
        .iter()
        .map(|file| debug_info.get_string(file.path_idx).unwrap().to_string())
        .collect::<Vec<_>>();
    assert!(
        paths.contains(&"increment-note/increment_note.masm".to_string()),
        "{paths:?}"
    );
    let root = root.to_string_lossy();
    assert!(
        debug_info
            .strings()
            .iter()
            .all(|string| !string.contains(root.as_ref())),
        "{paths:?}"
    );
}

#[test]
fn a_bad_instruction_is_one_error_with_its_span() {
    let copy = Copy::new();
    copy.edit(
        "counter-account/counter_account.masm",
        "movup.4 add",
        "movup.4 addd",
    );
    let (output, package) = copy.assemble("increment-note");
    assert_eq!(output["built"], false);
    assert!(package.is_none());
    assert_eq!(
        output["diagnostics"],
        json!([{
            "severity": "error",
            "message": "invalid syntax: invalid instruction `addd` or malformed operands",
            "file": "counter-account/counter_account.masm",
            "line": 25,
            "column": 13,
            "length": 4,
            "label": "invalid instruction `addd` or malformed operands",
        }])
    );
    // The rendered report names files relative to the project root.
    let rendered = output["rendered"].as_str().unwrap();
    assert!(
        rendered.contains("[counter-account/counter_account.masm:25:13]"),
        "{rendered}"
    );
    assert!(
        !rendered.contains(copy.root().to_str().unwrap()),
        "{rendered}"
    );
}

#[test]
fn a_warning_is_returned_with_its_span_and_the_package_is_written() {
    let copy = Copy::new();
    copy.edit(
        "counter-account/counter_account.masm",
        "use miden::core::sys\n",
        "use miden::core::sys\nuse miden::core::word\n",
    );
    let (output, package) = copy.assemble("counter-account");
    assert_eq!(output["built"], true);
    assert!(package.is_some());
    assert_eq!(
        output["diagnostics"],
        json!([{
            "severity": "warning",
            "message": "unused import",
            "file": "counter-account/counter_account.masm",
            "line": 4,
            "column": 18,
            "length": 4,
            "help": "this import is never used and can be safely removed",
        }])
    );
    let rendered = output["rendered"].as_str().unwrap();
    assert!(rendered.contains("unused import"), "{rendered}");
    assert!(
        rendered.contains("counter-account/counter_account.masm"),
        "{rendered}"
    );
    assert!(
        !rendered.contains(copy.root().to_str().unwrap()),
        "{rendered}"
    );
}

#[test]
fn a_dependency_path_that_leaves_the_project_is_refused() {
    let copy = Copy::new();
    std::fs::create_dir_all(copy.dir.join("outside")).unwrap();
    copy.edit(
        "increment-note/miden-project.toml",
        "\"../counter-account\"",
        "\"../../outside\"",
    );
    let (output, package) = copy.assemble("increment-note");
    assert_eq!(output["built"], false);
    assert!(package.is_none());
    assert_eq!(
        output["diagnostics"],
        json!([{
            "severity": "error",
            "message": "the path '../../outside' leaves the project root",
            "file": "increment-note/miden-project.toml",
        }])
    );
}

#[test]
fn a_missing_manifest_is_named() {
    let copy = Copy::new();
    let (output, _) = copy.assemble("nowhere");
    assert_eq!(output["built"], false);
    assert_eq!(
        output["diagnostics"],
        json!([{ "severity": "error", "message": "there is no nowhere/miden-project.toml" }])
    );
}

#[test]
fn an_entrypoint_outside_the_project_is_a_tool_failure() {
    let copy = Copy::new();
    let status = Command::new(env!("CARGO_BIN_EXE_miden-assemble"))
        .arg(copy.root())
        .arg("../projects/counter-account")
        .arg(copy.dir.join("out.masp"))
        .status()
        .unwrap();
    assert!(!status.success());
}
