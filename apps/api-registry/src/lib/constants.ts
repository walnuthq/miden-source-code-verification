import "dotenv/config";

export const PORT = process.env.PORT ?? "8081";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const API_COMPILE_URL =
  process.env.API_COMPILE_URL ?? "http://localhost:8080";
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://miden-source-code-verification:miden_source_code_verification_dev_password@localhost:5432/miden-source-code-verification";
