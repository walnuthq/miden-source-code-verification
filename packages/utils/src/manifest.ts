// A compiled package's manifest as api-compile returns it and the registry
// stores and serves it: the JSON that api-compile's `miden-package-metadata`
// crate prints with serde_json. Each type below mirrors the Rust type of the
// same name, from the crate versions that crate locks: `miden-mast-package`,
// `miden-assembly-syntax`, `miden-field` (0.29.4) and `midenc-hir-type`
// (0.10.2), so a bump of those needs this file re-checked. Rust enums are
// externally tagged unless noted: a unit variant is its name, any other
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

// `CallConv`, by discriminant (`serde_repr`): `0` = `Fast`, `1` = `C`,
// `2` = `Wasm`, `3` = `ComponentModel`.
export type CallConv = 0 | 1 | 2 | 3;

export type AddressSpace = "Byte" | "Element";

export type TypeRepr =
  | "Default"
  | { Align: number }
  | { Packed: number }
  | "Transparent"
  | "BigEndian";

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

export type Type =
  | "Unknown"
  | "Never"
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
  | { Function: FunctionType };

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
