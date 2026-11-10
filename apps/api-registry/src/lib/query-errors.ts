import { DrizzleQueryError } from "drizzle-orm";
import type { ErrorRequestHandler } from "express";

// Drizzle's message for a failed query is the SQL text and its parameters,
// which the error handler would answer as is. Mounted just before it: the
// client gets a fixed message, and the handler still logs the original as the
// `cause`.
export const hideQueryErrors: ErrorRequestHandler = (
  error: unknown,
  _req,
  _res,
  next,
) => {
  next(
    error instanceof DrizzleQueryError
      ? new Error("database query failed", { cause: error })
      : error,
  );
};
