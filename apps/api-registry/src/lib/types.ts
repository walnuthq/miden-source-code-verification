import type { packageTypeEnum } from "@/db/schema.js";

type PackageType = (typeof packageTypeEnum.enumValues)[number];

export type CargoToml = {
  package: {
    name: string;
    version: string;
    edition: string;
    metadata: {
      miden: {
        "project-kind": PackageType;
        dependencies: Record<string, { path: string }>;
      };
      component: {
        package: string;
        target: {
          dependencies: Record<string, { path: string }>;
        };
      };
    };
  };
};

type ProcedureSignature = { abi: number; params: string[]; results: string[] };

type ProcedureExport = {
  path: string;
  digest: string;
  signature: ProcedureSignature | null;
  attributes: { attrs: string[] };
};

type Export = { Procedure: ProcedureExport };

type Dependency = { name: string; digest: string };

export type Manifest = { exports: Export[]; dependencies: Dependency[] };
