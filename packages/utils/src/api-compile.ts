import type {
  AccountProcedures,
  ForeignCallingProcedures,
  Manifest,
  ProcedureParameters,
  ReadOnlyProcedures,
  TargetType,
} from "./manifest.ts";

// What api-compile answers. Its routes build their answers against these types
// (`satisfies`), and the registry's port reads them: one place names the wire
// format, so neither side mirrors the other by hand.

// The package a project built to, as the build returns it in memory.
export type BuiltPackage = {
  // The `.masp` artifact, base64-encoded: the dev package, with debug info.
  masp: string;
  commitment: string;
  // The package's own kind, which the registry stores as the package's type.
  kind: TargetType;
  manifest: Manifest;
  // Whether each exported procedure is read-only, by export path.
  readOnly: ReadOnlyProcedures;
  // Whether each exported procedure can make a foreign procedure invocation,
  // by export path: see `manifest.ts`.
  callsForeign: ForeignCallingProcedures;
  // Each exported procedure's parameter names and types, by export path, read
  // from the project's MASM source. Absent when the source couldn't be read:
  // see `manifest.ts`.
  parameters?: ProcedureParameters;
  // The digests of the account procedures a note or transaction script calls,
  // which the account it runs against must have. `null` when they can't be
  // told, absent for other packages: see `manifest.ts`.
  accountProcedures?: AccountProcedures;
  // The project as sent, keyed by path in the project.
  files: Record<string, string>;
};

// One problem the assembler found in a MASM project, as `miden-assemble`
// reports it (`spec/remove-rust/README.md`, "The MASM wire format"). `file` is
// relative to the project root, `line` and `column` start at 1, and `column`
// and `length` count characters. The span keys are absent when the problem
// has no place in a file, such as an unresolvable dependency.
export type BuildDiagnostic = {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  length?: number;
  // What the span is marked with in the rendered report.
  label?: string;
  help?: string;
};

// What a build reports beside its package (`spec/remove-rust/README.md`, "The
// MASM wire format").
export type AssemblyReport = {
  // Every problem the assembler found: none or warnings when the project
  // built, at least one error when it didn't.
  diagnostics: BuildDiagnostic[];
  // The versions the assembler was built with, as one string:
  // `miden-assembly 0.36.4, miden-protocol 0.18.0, …`.
  builtWith: string;
};

// `POST /compile`: the build's outcome, with the assembler's report either
// way, as text in `stderr` and as `diagnostics`; `stdout` is empty. A failed
// build is an answer, not a refused request: its diagnostics are what a
// compile client is after.
export type CompileResponse =
  | ({ built: false; stdout: string; stderr: string } & AssemblyReport)
  | ({ built: true; stdout: string; stderr: string } & BuiltPackage & AssemblyReport);

// `POST /verify`, when the project built (a failed build is a 400): whether
// its package is the resource's on chain, the resource's root, and the
// package.
export type VerifyResponse = {
  verified: boolean;
  // The resource's root as the verifier read it on chain: an account code root
  // or a note script root. The registry keys its record on it.
  root: string;
} & BuiltPackage &
  AssemblyReport;

// A standard account component `miden-import` detected in an account's code,
// with the procedure roots it claims.
export type StandardAccountComponent = { name: string; procedures: string[] };

// `GET /:networkId/import/:resourceId`: the on-chain code of a resource, an
// account code root or a note script root, which the registry keys its records
// on. An account also comes back with its standard components and every
// procedure root in its code, which the id-keyed account lookup forwards as
// is; a note with the name of the standard note it is (`P2ID`, …), or null.
export type ImportedResource =
  | {
      type: "account";
      code: string;
      standardAccountComponents: StandardAccountComponent[];
      procedures: string[];
    }
  | { type: "note"; code: string; standardNote: string | null };
