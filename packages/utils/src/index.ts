import { parse } from "smol-toml";

export type PackageType =
  | "account"
  | "note"
  | "tx-script"
  | "authentication-component";

export type CargoToml = {
  package: {
    name: string;
    version: string;
    edition: string;
  };
  lib: { "crate-type": string[] };
  dependencies: Record<string, string>;
};

export const parseCargoToml = (cargoToml: string) =>
  parse(cargoToml) as CargoToml;
