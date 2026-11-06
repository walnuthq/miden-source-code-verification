import type { ErrorRequestHandler, RequestHandler } from "express";

// Routes don't catch: they throw, and `errorHandler` answers `{ "error": … }`
// JSON with the status the error carries, or 500 without one. Both apps mount
// `notFound` then `errorHandler` last. Without them Express answers unknown
// paths and errors raised before a route runs (e.g. by `express.json`) with an
// HTML page.

// An error answered with its own status and headers, and its message as the
// body's `error`.
export class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    message: string,
    {
      headers = {},
      cause,
    }: { headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause });
    this.status = status;
    this.headers = headers;
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "not found" });
};

// Any error may carry a status, as `express.json`'s do (`statusCode` is how
// they spell it), and headers to answer with. Those from `express.json` also
// name their failure in `type` and, for a body over the limit, that limit.
type ThrownError = Error & {
  status?: unknown;
  statusCode?: unknown;
  headers?: unknown;
  type?: unknown;
  limit?: unknown;
};

const bodyErrorMessages: Record<string, (error: ThrownError) => string> = {
  "entity.parse.failed": () => "request body is not valid JSON",
  "entity.too.large": ({ limit }) =>
    `request body is larger than ${typeof limit === "number" ? `${limit / 1024 / 1024} MB` : "allowed"}`,
};

// The status an error asks for, when it is an error status; 500 otherwise.
const statusOf = (error: ThrownError) => {
  const status = error.status ?? error.statusCode;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : 500;
};

const headersOf = ({ headers }: ThrownError): Record<string, string> =>
  typeof headers === "object" && headers !== null
    ? Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

const messageOf = (error: ThrownError) =>
  (typeof error.type === "string" && bodyErrorMessages[error.type]?.(error)) ||
  error.message;

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  // The client went away before the answer (an aborted build, a dropped
  // connection): nobody is waiting for one, and nothing failed.
  if (res.closed) {
    return;
  }
  if (!(error instanceof Error)) {
    console.error(error);
    res.status(500).json({ error: "internal error" });
    return;
  }
  const status = statusOf(error);
  if (status >= 500) {
    console.error(error);
  }
  res
    .status(status)
    .set(headersOf(error))
    .json({ error: messageOf(error) });
};
