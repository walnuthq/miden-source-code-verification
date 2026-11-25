//! Keeps a build inside its project root.
//!
//! The assembler reads whatever a manifest names: a dependency's `path`, a
//! target's `path`, a workspace's `members`, absolute or with `..`, and it
//! clones a `git` dependency with the `git` binary. It also looks for a
//! workspace manifest in every directory above the one it starts from. So,
//! before it runs, every `miden-project.toml` in the project is read here and
//! refused when it names a path outside the project, a path that isn't plain
//! (the assembler reads some as URIs, `file://localhost/…` among them), or a
//! git repository; the project may hold no symbolic link, and the directories
//! above it must hold no manifest.

use anyhow::{Result, bail};
use std::path::{Component, Path, PathBuf};
use toml::{Table, Value};

/// The manifest file the assembler reads in each directory.
pub const MANIFEST: &str = "miden-project.toml";

/// Why a project is refused: the file, relative to the project root (a
/// manifest, or a symbolic link), and the reason.
#[derive(Debug, PartialEq)]
pub struct Refusal {
    pub file: String,
    pub reason: String,
}

/// What a path in a manifest may not contain: the assembler reads a path as a
/// URI, so a scheme (`file:`, in any case), a query, a fragment or a
/// percent-escape would make it read another path than the one checked here.
const NOT_PLAIN: [char; 5] = [':', '?', '#', '%', '\\'];

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

/// The first symbolic link under `root`, which must be canonical, or else the
/// first manifest that names a path outside it, a path that isn't plain, or a
/// git repository. A manifest that isn't valid TOML is left to the assembler,
/// which reports it if it reads it.
pub fn check_project(root: &Path) -> Result<Option<Refusal>> {
    let mut manifests = Vec::new();
    let mut links = Vec::new();
    walk(root, &mut manifests, &mut links)?;
    links.sort();
    if let Some(link) = links.first() {
        return Ok(Some(Refusal {
            file: relative(link, root),
            reason: "symbolic links are not supported".into(),
        }));
    }
    manifests.sort();
    for manifest in manifests {
        let Ok(table) = std::fs::read_to_string(&manifest)?.parse::<Table>() else {
            continue;
        };
        let directory = manifest.parent().expect("a file has a parent");
        if let Some(reason) = check_table(&table, directory, root) {
            return Ok(Some(Refusal {
                file: relative(&manifest, root),
                reason,
            }));
        }
    }
    Ok(None)
}

/// Every manifest and every symbolic link under `directory`, links not
/// followed.
fn walk(directory: &Path, manifests: &mut Vec<PathBuf>, links: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            links.push(entry.path());
        } else if file_type.is_dir() {
            walk(&entry.path(), manifests, links)?;
        } else if entry.file_name() == MANIFEST {
            manifests.push(entry.path());
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

/// Why `path`, relative to `directory`, is refused: it isn't a plain path,
/// or its components lead out of `root`. The project holds no symbolic link,
/// so the components say where it leads.
fn check_path(path: &str, directory: &Path, root: &Path) -> Option<String> {
    if path.contains(NOT_PLAIN) {
        return Some(format!("the path '{path}' is not a plain path"));
    }
    (!normalize(&directory.join(path)).starts_with(root))
        .then(|| format!("the path '{path}' leaves the project root"))
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
        let refusal = check_project(&root).unwrap();
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
                file: "a/miden-project.toml".into(),
                reason: "the path '../../b' leaves the project root".into(),
            })
        );
    }

    #[test]
    fn refuses_absolute_paths_and_uris() {
        for path in [
            "/etc",
            "file:///etc",
            "FILE:///etc",
            "file://localhost/etc/hosts",
            // Read as a URI, its path ends at `#`: `x/../..`.
            "x/../..#a/..",
            "%2e%2e/%2e%2e/etc",
        ] {
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
    fn refuses_any_symbolic_link() {
        // Named by no manifest: a module directory could reach it.
        let (base, root) = project(&[("a", "[lib]\npath = \"a.masm\"\n")]);
        std::os::unix::fs::symlink(&base, root.join("a/link")).unwrap();
        let refusal = check_project(&root).unwrap();
        std::fs::remove_dir_all(base).unwrap();
        assert_eq!(
            refusal,
            Some(Refusal {
                file: "a/link".into(),
                reason: "symbolic links are not supported".into(),
            })
        );
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
