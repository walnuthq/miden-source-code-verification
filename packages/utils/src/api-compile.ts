import type {
  AccountProcedures,
  ForeignCallingProcedures,
  Manifest,
  NoteStorageSchema,
  ProcedureParameters,
  ReadOnlyProcedures,
  StorageSchema,
  TargetType,
} from "./manifest.ts";

// What api-compile answers. Its routes build their answers against these types
// (`satisfies`), and the registry's port reads them: one place names the wire
// format, so neither side mirrors the other by hand.

// The package a project built to, as the build returns it in memory.
export type BuiltPackage = {
  // The `.masp` artifact, base64-encoded.
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
  // Each exported procedure's parameter names and types, by export path: from
  // the package's WIT for a Rust project, from the source for a MASM one.
  // Absent when neither could be read: see `manifest.ts`.
  parameters?: ProcedureParameters;
  // The digests of the account procedures a note or transaction script calls,
  // which the account it runs against must have. `null` when they can't be
  // told, absent for other packages: see `manifest.ts`.
  accountProcedures?: AccountProcedures;
  // An account component's storage slots. Absent for other packages, for a
  // MASM package, which has no schema, and when the schema couldn't be read.
  storage?: StorageSchema;
  // A note's storage, its inputs. Absent for other packages, for a MASM note,
  // for a note that declares none, and when the schema couldn't be read.
  noteStorage?: NoteStorageSchema;
  // The sources plus the lockfile the build used, keyed by path in the
  // project, so a client can resubmit them and get the same dependency
  // versions. A MASM project has no lockfile: its files come back as sent.
  files: Record<string, string>;
};

// The release build's Miden Assembly, as text. It never fails the request
// it's part of, so a failure is an `error`. It's for reading: it calls library
// procedures (`miden::protocol::*`, `intrinsics::*`) without including them,
// so it doesn't reassemble into the package on its own.
export type MasmOutput = { source: string } | { error: string };

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

// What a MASM build adds to its answer (`spec/remove-rust/README.md`, "The
// MASM wire format"). Both are absent from a Rust project's answer.
export type AssemblyReport = {
  // Every problem the assembler found: none or warnings when the project
  // built, at least one error when it didn't.
  diagnostics?: BuildDiagnostic[];
  // The versions the assembler was built with, as one string:
  // `miden-assembly 0.36.4, miden-protocol 0.18.0, …`.
  builtWith?: string;
};

// `POST /compile`: the build's outcome, with the toolchain's output either
// way: cargo-miden's for a Rust project; for a MASM project the assembler's
// report as text in `stderr` and as `diagnostics`, and an empty `stdout`. A
// failed build is an answer, not a refused request: its diagnostics are what a
// compile client is after.
export type CompileResponse =
  | ({ built: false; stdout: string; stderr: string } & AssemblyReport)
  | ({
      built: true;
      stdout: string;
      stderr: string;
      // Set when `masm` was requested, for a Rust project only.
      masm?: MasmOutput;
    } & BuiltPackage &
      AssemblyReport);

// `POST /verify`, when the project built (a failed build is a 400): whether
// its package is the resource's on chain, the resource's root, and the
// package.
export type VerifyResponse = {
  verified: boolean;
  // The resource's root as the verifier read it on chain: an account code root
  // or a note script root. The registry keys its record on it.
  root: string;
  // The cargo-miden that built a Rust project. Absent for a MASM project, and
  // when its version couldn't be read.
  cargoMidenVersion?: string;
} & BuiltPackage &
  AssemblyReport;

// A standard account component `miden-import` detected in an account's code,
// with the procedure roots it claims.
export type StandardAccountComponent = { name: string; procedures: string[] };

// `GET /:networkId/import/:resourceId`: the on-chain code of a resource, an
// account code root or a note script root, which the registry keys its records
// on. An account also comes back with its standard components and every
// procedure root in its code, which the id-keyed account lookup forwards as
// is.
export type ImportedResource =
  | {
      type: "account";
      code: string;
      standardAccountComponents: StandardAccountComponent[];
      procedures: string[];
    }
  | { type: "note"; code: string };
