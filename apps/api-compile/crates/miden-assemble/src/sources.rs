//! Names a project's sources by their path in the project.
//!
//! The assembler reads every file through its source manager, and a file's
//! name there is what the package's debug info records for it. The project
//! loader names each file by its canonical, absolute path, which for a build
//! is a temporary directory of its own: two builds of the same project would
//! write different packages, and the package would name the server's
//! directories. This source manager renames each file under the project root
//! to its path relative to the root as it is loaded, so the debug info names
//! `counter-contract/counter_contract.masm`, the key the project's files are
//! stored under. Files outside the root, such as the libraries compiled into
//! the tool, keep their names. The tool runs with the project root as its
//! working directory, so a relative name still reads the file it names.

use miden_assembly::debuginfo::{
    DefaultSourceManager, FileLineCol, Location, Selection, SourceContent, SourceFile, SourceId,
    SourceManager, SourceManagerError, SourceSpan, Uri,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug)]
pub struct ProjectSourceManager {
    root: PathBuf,
    inner: DefaultSourceManager,
}

impl ProjectSourceManager {
    /// A source manager for the project at `root`, which must be canonical.
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            inner: DefaultSourceManager::default(),
        }
    }

    /// `uri` relative to the project root, when it names a file under it.
    fn relative(&self, uri: &Uri) -> Option<Uri> {
        let path = uri.to_path()?;
        let relative = path.strip_prefix(&self.root).ok()?;
        (!relative.as_os_str().is_empty()).then(|| Uri::from(relative))
    }
}

impl SourceManager for ProjectSourceManager {
    fn load_from_raw_parts(&self, name: Uri, content: SourceContent) -> Arc<SourceFile> {
        match self.relative(&name) {
            Some(relative) => {
                let content = SourceContent::new(
                    content.language(),
                    relative.clone(),
                    content.as_str().to_string(),
                );
                self.inner.load_from_raw_parts(relative, content)
            }
            None => self.inner.load_from_raw_parts(name, content),
        }
    }

    fn update(
        &self,
        id: SourceId,
        text: String,
        range: Option<Selection>,
        version: i32,
    ) -> Result<(), SourceManagerError> {
        self.inner.update(id, text, range, version)
    }

    fn get(&self, id: SourceId) -> Result<Arc<SourceFile>, SourceManagerError> {
        self.inner.get(id)
    }

    fn find(&self, uri: &Uri) -> Option<SourceId> {
        // A file asked for by its absolute path is the one renamed on load.
        self.relative(uri)
            .and_then(|relative| self.inner.find(&relative))
            .or_else(|| self.inner.find(uri))
    }

    fn file_line_col_to_span(&self, loc: FileLineCol) -> Option<SourceSpan> {
        self.inner.file_line_col_to_span(loc)
    }

    fn file_line_col(&self, span: SourceSpan) -> Result<FileLineCol, SourceManagerError> {
        self.inner.file_line_col(span)
    }

    fn location_to_span(&self, loc: Location) -> Option<SourceSpan> {
        self.inner.location_to_span(loc)
    }

    fn location(&self, span: SourceSpan) -> Result<Location, SourceManagerError> {
        self.inner.location(span)
    }

    fn source(&self, id: SourceId) -> Result<&str, SourceManagerError> {
        self.inner.source(id)
    }

    fn source_slice(&self, span: SourceSpan) -> Result<&str, SourceManagerError> {
        self.inner.source_slice(span)
    }
}
