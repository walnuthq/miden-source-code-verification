//! A failed assembly's report, as the diagnostics `POST /compile` answers.
//!
//! The assembler returns one miette report per failure. Its leaves are the
//! diagnostics a user acts on: a syntax error wraps one per mistake in the
//! module (`#[related]`), and only a report without related ones is a leaf
//! itself. A leaf's span is read from its own source code or, failing that,
//! from the nearest wrapper's, which is where the assembler keeps the file.

use miden_assembly::diagnostics::miette::{SourceCode, SourceSpan};
use miden_assembly::diagnostics::reporting::PrintDiagnostic;
use miden_assembly::diagnostics::{Diagnostic, Report, Severity};
use serde_json::{Map, Value, json};
use std::path::Path;

/// Each leaf of `report`, as `{ severity, message, file?, line?, column?,
/// length?, label?, help? }`. `file` is relative to `root`, `line` and
/// `column` start at 1, `column` and `length` count characters. `severity`
/// overrides the report's own, for warnings the assembler returned as errors.
pub fn collect(report: &Report, root: &Path, severity: Option<&str>) -> Vec<Value> {
    let mut diagnostics = Vec::new();
    walk(report.as_ref(), None, root, severity, &mut diagnostics);
    diagnostics
}

/// The report as the assembler renders it, without colours, with `root` cut
/// off the paths it names.
pub fn render(report: &Report, root: &Path) -> String {
    strip_root(
        &PrintDiagnostic::new_without_color(report).to_string(),
        root,
    )
}

fn walk<'a>(
    diagnostic: &'a dyn Diagnostic,
    inherited: Option<&'a dyn SourceCode>,
    root: &Path,
    severity: Option<&str>,
    out: &mut Vec<Value>,
) {
    let source = diagnostic.source_code().or(inherited);
    let mut related = diagnostic.related().into_iter().flatten().peekable();
    if related.peek().is_some() {
        for other in related {
            walk(other, source, root, severity, out);
        }
        return;
    }

    let mut entry = Map::new();
    // The wire format knows errors and warnings: advice is a warning.
    let severity = severity.unwrap_or(match diagnostic.severity() {
        Some(Severity::Warning | Severity::Advice) => "warning",
        Some(Severity::Error) | None => "error",
    });
    entry.insert("severity".into(), json!(severity));
    entry.insert(
        "message".into(),
        json!(strip_root(&diagnostic.to_string(), root)),
    );

    let labels = diagnostic
        .labels()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    // The primary label, or the first when none is marked.
    let label = labels
        .iter()
        .find(|label| label.primary())
        .or(labels.first());
    if let (Some(label), Some(source)) = (label, source) {
        span(source, label.inner(), root, &mut entry);
        if let Some(text) = label.label() {
            entry.insert("label".into(), json!(text));
        }
    }
    if let Some(help) = diagnostic.help() {
        entry.insert("help".into(), json!(strip_root(&help.to_string(), root)));
    }
    out.push(Value::Object(entry));
}

/// Where `span` is in `source`, as `file`, `line`, `column` and `length`.
/// Left out when the span can't be read.
fn span(source: &dyn SourceCode, span: &SourceSpan, root: &Path, entry: &mut Map<String, Value>) {
    let Ok(contents) = source.read_span(span, 0, 0) else {
        return;
    };
    if let Some(name) = contents.name() {
        entry.insert("file".into(), json!(relative(name, root)));
    }
    // `SourceFile` counts its columns in characters, from 0.
    entry.insert("line".into(), json!(contents.line() + 1));
    entry.insert("column".into(), json!(contents.column() + 1));
    entry.insert(
        "length".into(),
        json!(String::from_utf8_lossy(contents.data()).chars().count()),
    );
}

/// `name` relative to `root`, or as it is when it isn't under it.
fn relative(name: &str, root: &Path) -> String {
    let name = name.strip_prefix("file://").unwrap_or(name);
    Path::new(name)
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| name.to_string())
}

/// `text` with every mention of `root` and the separator after it removed.
fn strip_root(text: &str, root: &Path) -> String {
    let root = root.to_string_lossy();
    text.replace(&format!("file://{root}/"), "")
        .replace(&format!("{root}/"), "")
        .replace(root.as_ref(), ".")
}
