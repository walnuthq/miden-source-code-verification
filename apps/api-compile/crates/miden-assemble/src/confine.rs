//! Keeps a build inside its project root.
//!
//! The assembler reads whatever a manifest names: a dependency's `path`, a
//! target's `path`, a workspace's `members`, absolute or with `..`, and it
//! clones a `git` dependency with the `git` binary. It also looks for a
//! workspace manifest in every directory above the one it starts from. So,
//! before it runs, every `miden-project.toml` in the project is read here and
//! refused when it names a path outside the project or a git repository, and
//! the directories above the project must hold no manifest.

use anyhow::{Result, bail};
use std::path::{Component, Path, PathBuf};
use toml::{Table, Value};

/// The manifest file the assembler reads in each directory.
pub const MANIFEST: &str = "miden-project.toml";

/// Why a manifest is refused: the manifest, relative to the project
/// directory, and what it names.
#[derive(Debug, PartialEq)]
pub struct Refusal {
    pub manifest: String,
    pub reason: String,
}

/// Checks the directories above `root`, which must be canonical: a manifest
/// there would be read as the project's workspace. A tool failure, not a
/// refused project: the client put nothing there.
pub fn check_ancestors(root: &Path) -> Result<()> {
    for ancestor in root.ancestors().skip(1) {
        let manifest = ancestor.join(MANIFEST);
        if manifest.exists() {
            bail!(
                "'{}' sits above the project root and would be read as its workspace",
                manifest.display()
            );
        }
    }
    Ok(())
}

/// The first manifest under `root`, which must be canonical, that names a
/// path outside it or a git repository. A manifest that isn't valid TOML is
/// left to the assembler, which reports it if it reads it.
pub fn check_manifests(root: &Path) -> Result<Option<Refusal>> {
    let mut manifests = Vec::new();
    find_manifests(root, &mut manifests)?;
    manifests.sort();
    for manifest in manifests {
        let Ok(table) = std::fs::read_to_string(&manifest)?.parse::<Table>() else {
            continue;
        };
        let directory = manifest.parent().expect("a file has a parent");
        if let Some(reason) = check_table(&table, directory, root) {
            return Ok(Some(Refusal {
                manifest: relative(&manifest, root),
                reason,
            }));
        }
    }
    Ok(None)
}

/// Every manifest under `directory`, symbolic links not followed.
fn find_manifests(directory: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            find_manifests(&entry.path(), out)?;
        } else if entry.file_name() == MANIFEST {
            out.push(entry.path());
        }
    }
    Ok(())
}

/// Why `table`, from the manifest in `directory`, is refused, if it is.
/// Every `path` and every `members` entry is read as a path, wherever it sits:
/// a key the assembler doesn't read as one is refused only when it leaves the
/// project, which costs nothing.
fn check_table(table: &Table, directory: &Path, root: &Path) -> Option<String> {
    for (key, value) in table {
        match (key.as_str(), value) {
            ("git", _) => return Some("git dependencies are not supported".into()),
            ("path", Value::String(path)) => {
                if let Some(reason) = check_path(path, directory, root) {
                    return Some(reason);
                }
            }
            ("members", Value::Array(members)) => {
                for member in members.iter().filter_map(Value::as_str) {
                    if let Some(reason) = check_path(member, directory, root) {
                        return Some(reason);
                    }
                }
            }
            (_, Value::Table(table)) => {
                if let Some(reason) = check_table(table, directory, root) {
                    return Some(reason);
                }
            }
            (_, Value::Array(items)) => {
                for table in items.iter().filter_map(Value::as_table) {
                    if let Some(reason) = check_table(table, directory, root) {
                        return Some(reason);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Why `path`, relative to `directory`, is refused: it leaves `root`, by its
/// components or, when it exists, through a symbolic link.
fn check_path(path: &str, directory: &Path, root: &Path) -> Option<String> {
    let plain = path.strip_prefix("file://").unwrap_or(path);
    let joined = normalize(&directory.join(plain));
    let inside = joined.starts_with(root)
        && joined
            .canonicalize()
            .map_or(true, |canonical| canonical.starts_with(root));
    (!inside).then(|| format!("the path '{path}' leaves the project root"))
}

/// `path` with its `.` and `..` components resolved, without reading the
/// file system.
fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other),
        }
    }
    normalized
}

/// `path` relative to `root`, or as it is when it isn't under it.
pub fn relative(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A directory holding `project/`, with `manifests` written into it by
    /// directory, and the canonical path of `project/`. Each call gets its own,
    /// as the tests run in parallel.
    fn project(manifests: &[(&str, &str)]) -> (PathBuf, PathBuf) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let base = std::env::temp_dir().join(format!(
            "miden-assemble-confine-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("project");
        for (directory, manifest) in manifests {
            let directory = root.join(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join(MANIFEST), manifest).unwrap();
        }
        let root = root.canonicalize().unwrap();
        (base, root)
    }

    fn refusal(manifests: &[(&str, &str)]) -> Option<Refusal> {
        let (base, root) = project(manifests);
        let refusal = check_manifests(&root).unwrap();
        std::fs::remove_dir_all(base).unwrap();
        refusal
    }

    #[test]
    fn accepts_paths_inside_the_project() {
        assert_eq!(
            refusal(&[
                ("a", "[lib]\npath = \"a.masm\"\n"),
                (
                    "b",
                    "[lib]\npath = \"./src/b.masm\"\n[dependencies]\na = { path = \"../a\" }\n"
                ),
            ]),
            None
        );
    }

    #[test]
    fn refuses_a_dependency_path_that_leaves_the_project() {
        assert_eq!(
            refusal(&[("a", "[dependencies]\nb = { path = \"../../b\" }\n")]),
            Some(Refusal {
                manifest: "a/miden-project.toml".into(),
                reason: "the path '../../b' leaves the project root".into(),
            })
        );
    }

    #[test]
    fn refuses_absolute_and_file_uri_paths() {
        for path in ["/etc", "file:///etc"] {
            let manifest = format!("[lib]\npath = \"{path}\"\n");
            assert!(refusal(&[("a", &manifest)]).is_some(), "{path}");
        }
    }

    #[test]
    fn refuses_workspace_members_outside_the_project() {
        assert!(refusal(&[("", "[workspace]\nmembers = [\"a\", \"../x\"]\n")]).is_some());
        assert_eq!(
            refusal(&[("", "[workspace]\nmembers = [\"a\"]\n"), ("a", "")]),
            None
        );
    }

    #[test]
    fn refuses_git_dependencies() {
        assert_eq!(
            refusal(&[(
                "a",
                "[dependencies]\nb = { git = \"https://example.com/b\" }\n"
            )])
            .map(|refusal| refusal.reason),
            Some("git dependencies are not supported".into())
        );
    }

    #[test]
    fn refuses_a_symbolic_link_out_of_the_project() {
        let (base, root) = project(&[("a", "[lib]\npath = \"link/x.masm\"\n")]);
        std::os::unix::fs::symlink(&base, root.join("a/link")).unwrap();
        std::fs::write(base.join("x.masm"), "").unwrap();
        let refusal = check_manifests(&root).unwrap();
        std::fs::remove_dir_all(base).unwrap();
        assert!(refusal.is_some());
    }

    #[test]
    fn ancestors_must_hold_no_manifest() {
        // A manifest at the project's root sits above `a`.
        let (base, root) = project(&[("", "")]);
        assert!(check_ancestors(&root.join("a")).is_err());
        assert!(check_ancestors(&root).is_ok());
        std::fs::remove_dir_all(base).unwrap();
    }
}
