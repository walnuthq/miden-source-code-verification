import "dotenv/config";

export const PORT = process.env.PORT ?? "8080";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "/cache/target";
export const MIDEN_VERIFIER_CACHE_DIR =
  process.env.MIDEN_VERIFIER_CACHE_DIR ?? "/cache";
