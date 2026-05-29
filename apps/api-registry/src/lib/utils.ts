import { parse } from "smol-toml";
import type { CargoToml } from "@/lib/types.js";

export const parseCargoToml = (cargoToml: string) =>
  parse(cargoToml) as CargoToml;
