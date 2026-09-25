import type { packageTypeEnum } from "@/db/schema.js";

type PackageType = (typeof packageTypeEnum.enumValues)[number];

type ProcedureSignature = { abi: number; params: string[]; results: string[] };

type ProcedureExport = {
  path: string;
  digest: `0x${string}`;
  signature: ProcedureSignature | null;
  attributes: { attrs: string[] };
};

type Export = { Procedure: ProcedureExport };

type Dependency = {
  name: string;
  kind: PackageType;
  version: string;
  digest: string;
};

export type Manifest = { exports: Export[]; dependencies: Dependency[] };

// A standard account component detected in an account's code by api-compile's
// `/import`, with the procedure roots it claims.
export type StandardAccountComponent = { name: string; procedures: string[] };
