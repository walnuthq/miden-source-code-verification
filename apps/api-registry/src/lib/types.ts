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
