import { DrizzleQueryError } from "drizzle-orm";
import type { ErrorRequestHandler } from "express";

// A transaction whose connection failed before any query ran. Its `cause` is
// the driver's error, whose message names the database host and port.
export class DatabaseConnectionError extends Error {
  constructor(options: { cause: unknown }) {
    super("database connection failed", options);
    this.name = "DatabaseConnectionError";
  }
}

// Drizzle's message for a failed query is the SQL text and its parameters, and
// a failed connection's names the database host and port; the error handler
// would answer either as is. Mounted just before it: the client gets a fixed
// message, and the handler still logs the original as the `cause`.
export const hideQueryErrors: ErrorRequestHandler = (
  error: unknown,
  _req,
  _res,
  next,
) => {
  next(
    error instanceof DrizzleQueryError ||
      error instanceof DatabaseConnectionError
      ? new Error("database query failed", { cause: error })
      : error,
  );
};
