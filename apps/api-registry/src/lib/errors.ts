import type { ErrorRequestHandler, RequestHandler } from "express";

// Without these, Express answers unknown paths and errors raised before a route
// runs (e.g. by `express.json`) with an HTML page. Every error is JSON instead,
// `{ "error": … }`, like the routes' own.

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "not found" });
};

// Errors from `express.json` carry the status to answer with and a `type`.
type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
  limit?: number;
};

const bodyErrorMessages: Record<string, (error: HttpError) => string> = {
  "entity.parse.failed": () => "request body is not valid JSON",
  "entity.too.large": ({ limit }) =>
    `request body is larger than ${limit ? `${limit / 1024 / 1024} MB` : "allowed"}`,
};

export const errorHandler: ErrorRequestHandler = (
  error: HttpError,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.status ?? error.statusCode ?? 500;
  if (status >= 500) {
    console.error(error);
  }
  const message =
    (error.type && bodyErrorMessages[error.type]?.(error)) ??
    (status >= 500 ? "internal error" : error.message);
  res.status(status).json({ error: message });
};
