// A compiled package's manifest as api-compile returns it and the registry
// stores and serves it: the JSON that api-compile's `miden-package-metadata`
// crate prints. Each type below mirrors the Rust type of the same name, from
// the crate versions that crate locks: `miden-mast-package`,
// `miden-assembly-syntax`, `miden-field` (0.35.0) and `midenc-hir-type`
// (0.17.0), so a bump of those needs this file re-checked. Those types no
// longer derive `serde`, so the crate's `main.rs` writes the JSON by hand, in
// the shape their derives used to produce: Rust enums are externally tagged
// unless noted, a unit variant being its name and any other
// `{ Variant: payload }`. An `Option` is `null` when absent, as none of these
// skip it.

// `miden-mast-package` `TargetType`, by its canonical name (`as_str`): the
// kind of a package. A value rather than only a type so the registry can build
// its `package_type` database enum from the same list.
export const TARGET_TYPES = [
  "library",
  "executable",
  "kernel",
  "account-component",
  "note",
  "transaction-script",
] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

// `miden-field` `Felt`: its canonical `u64`. Values above 2^53 lose precision
// once parsed into a JavaScript number.
export type Felt = number;

// `miden-field` `Word`: its 32 bytes, `0x`-prefixed hex.
export type Word = `0x${string}`;

// ─── midenc-hir-type ────────────────────────────────────────────────────────

// `CallConv`, the conventions predating `Extern` by discriminant, as
// `serde_repr` wrote them: `0` = `Fast`, `1` = `C`, `2` = `Wasm`,
// `3` = `ComponentModel`. `Extern` is a convention a language frontend defines,
// by name, so it is tagged instead.
export type CallConv = 0 | 1 | 2 | 3 | { Extern: string };

export type AddressSpace = "Byte" | "Element";

export type TypeRepr =
  | "Default"
  | { Align: number }
  | { Packed: number }
  | "Transparent";

export type PointerType = { addrspace: AddressSpace; pointee: Type };

export type StructField = {
  name: string | null;
  index: number;
  align: number;
  offset: number;
  ty: Type;
};

export type StructType = {
  name: string | null;
  repr: TypeRepr;
  size: number;
  fields: StructField[];
};

export type Variant = {
  name: string;
  discriminant_value: number | null;
  value: Type | null;
};

export type EnumType = {
  name: string;
  discriminant: Type;
  variants: Variant[];
  offsets: number[];
  size: number;
  align: number;
};

export type ArrayType = { ty: Type; len: number };

export type FunctionType = { abi: CallConv; params: Type[]; results: Type[] };

// A recursive struct or enum is written out in full where it is first reached,
// and as `{ Rec: name }` wherever it recurs inside its own definition; a `Rec`
// therefore always refers to an enclosing `Struct` or `Enum` of that name.
// `Rec` is not a Rust variant but how `miden-package-metadata` breaks the cycle.
export type Type =
  | "Unknown"
  | "Never"
  | "Variadic"
  | "I1"
  | "I8"
  | "U8"
  | "I16"
  | "U16"
  | "I32"
  | "U32"
  | "I64"
  | "U64"
  | "I128"
  | "U128"
  | "U256"
  | "F64"
  | "Felt"
  | { Ptr: PointerType }
  | { Struct: StructType }
  | { Enum: EnumType }
  | { Array: ArrayType }
  | { List: Type }
  | { Function: FunctionType }
  | { Rec: string | null };

// ─── miden-assembly-syntax ──────────────────────────────────────────────────

// `IntValue`, untagged: a `u8`, `u16`, `u32` or `Felt`, all plain numbers.
export type IntValue = number;

// `WordValue`, transparent over `[Felt; 4]`.
export type WordValue = [Felt, Felt, Felt, Felt];

export type HashKind = "Word" | "Event";

// A `Span<T>` serializes as its `T`, so the spans here leave no trace.
export type ConstantValue =
  | { Int: IntValue }
  | { String: string }
  | { Word: WordValue }
  | { Hash: [HashKind, string] };

// `MetaExpr` tags its variants in lowercase (`rename_all = "lowercase"`).
export type MetaExpr =
  | { ident: string }
  | { int: IntValue }
  | { word: WordValue }
  | { string: string };

export type MetaList = { name: string; items: MetaExpr[] };

export type MetaKeyValue = { name: string; items: Record<string, MetaExpr> };

export type Attribute =
  | { Marker: string }
  | { List: MetaList }
  | { KeyValue: MetaKeyValue };

export type AttributeSet = { attrs: Attribute[] };

// ─── miden-mast-package ─────────────────────────────────────────────────────

export type ProcedureExport = {
  path: string;
  node: number | null;
  source_node: number | null;
  digest: Word;
  signature: FunctionType | null;
  attributes: AttributeSet;
};

export type ConstantExport = { path: string; value: ConstantValue };

export type TypeExport = { path: string; ty: Type };

export type PackageExport =
  | { Procedure: ProcedureExport }
  | { Constant: ConstantExport }
  | { Type: TypeExport };

export type Dependency = {
  name: string;
  kind: TargetType;
  version: string;
  digest: Word;
};

// Not the whole `PackageManifest`: `miden-package-metadata` prints only its
// exports and dependencies.
export type Manifest = {
  exports: PackageExport[];
  dependencies: Dependency[];
};

// Whether each procedure a package exports is read-only, by export path: what
// `miden-package-metadata` prints next to the manifest, read from the MAST
// (`read_only.rs`), since the toolchain doesn't record it. `true` when nothing
// the procedure can reach changes state (account storage, vault, nonce or code,
// output notes...), `false` when something can, `null` when it can't be told
// (a dynamic call, a direct syscall, or a procedure from a package other than
// the core, protocol and standards libraries).
export type ReadOnlyProcedures = Record<string, boolean | null>;

// An account component's storage slots, from the account component metadata
// the toolchain embeds in its package (`schemas.rs` in
// `miden-package-metadata`), in the metadata's order. Types are the schema's
// names: `word` and `felt`, or a named type such as
// `miden::standards::auth::pub_key`.
export type StorageSchema = { slots: StorageSlotSchema[] };

export type StorageSlotSchema = {
  // The slot's full name, e.g. `counter_contract::counter_contract::count_map`.
  name: string;
  description?: string;
} & (
  | {
      type: "value";
      valueType: string;
      // The slot's default word (32-byte hex), when the schema gives one. A
      // composite slot (one schema per felt) is reported as a `word` with
      // neither its felts' types nor its default.
      defaultValue?: string;
    }
  // A map's default entries aren't reported.
  | { type: "map"; keyType: string; valueType: string }
);

// A note's storage, its inputs: the fields of the record the toolchain embeds
// as the note's storage schema (WIT, in the `note_storage_schema` section), in
// declaration order, which is the order their felts take in the note's
// storage.
export type NoteStorageSchema = {
  // The record's WIT name, e.g. `p2id-note` (`storage` if it had none, which
  // WIT doesn't allow).
  name: string;
  fields: NoteStorageField[];
};

export type NoteStorageField = {
  // The field's WIT name, in kebab case, e.g. `target-account-id`.
  name: string;
  // Its WIT type name: `felt`, `word`, `account-id`, `asset-amount`, `u64`,
  // `u32`, `u8`, `bool`, or a record the note defines. A structural kind
  // (`option`, `variant`, `record`) when the type has no name.
  type: string;
  // The felts it takes in the note's storage. Absent when that varies (an
  // `option`, or a `variant` whose cases differ in width). A record the note
  // defines comes with its width only, not its own fields.
  width?: number;
  description?: string;
};

// The paths of the procedures a manifest exports, e.g.
// `miden:counter-contract/counter-contract@0.1.0#increment-count`. A release
// and a debug build of the same source export the same paths under different
// digests, which is how the simulator pairs them.
export const procedureExportPaths = (manifest: Manifest) =>
  manifest.exports.flatMap((packageExport) =>
    "Procedure" in packageExport ? [packageExport.Procedure.path] : [],
  );
