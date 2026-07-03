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
