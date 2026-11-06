import type { Manifest, ReadOnlyProcedures, TargetType } from "./manifest.ts";

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
  // The sources plus the lockfile the build used, keyed by path in the
  // project, so a client can resubmit them and get the same dependency
  // versions.
  files: Record<string, string>;
};

// A debug build of the same sources: its package with debug info, which names
// call-trace frames but has other procedure roots than the release build. It
// never fails the request it's part of, so a failure is an `error`.
export type DebugBuild =
  | {
      masp: string;
      commitment: string;
      manifest: Manifest;
      cargoMidenVersion?: string;
    }
  | { error: string };

// The release build's Miden Assembly, as text. Like the debug build, it never
// fails the request it's part of, so a failure is an `error`. It's for
// reading: it calls library procedures (`miden::protocol::*`, `intrinsics::*`)
// without including them, so it doesn't reassemble into the package on its
// own.
export type MasmOutput = { source: string } | { error: string };

// `POST /compile`: the build's outcome, with cargo-miden's output either way.
// A failed build is an answer, not a refused request: its diagnostics are what
// a compile client is after.
export type CompileResponse =
  | { built: false; stdout: string; stderr: string }
  | ({
      built: true;
      stdout: string;
      stderr: string;
      // Set when `debug` was requested.
      debug?: DebugBuild;
      // Set when `masm` was requested.
      masm?: MasmOutput;
    } & BuiltPackage);

// `POST /verify`, when the project built (a failed build is a 400): whether
// its package is the resource's on chain, the resource's root, and the
// package.
export type VerifyResponse = {
  verified: boolean;
  // The resource's root as the verifier read it on chain: an account code root
  // or a note script root. The registry keys its record on it.
  root: string;
  // The cargo-miden that built it. Absent when its version couldn't be read.
  cargoMidenVersion?: string;
  // Set when `debug` was requested. Its failure is `debug.error`, which never
  // changes `verified`.
  debug?: DebugBuild;
} & BuiltPackage;

// `POST /compile-debug`, when the release build still has the expected
// commitment (a 409 otherwise, and a 400 for a failed build).
export type CompileDebugResponse = { debug: DebugBuild };

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
