import { tmpdir } from "node:os";

export const PORT = process.env.PORT ?? "8080";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const MIDEN_CLIENT_CACHE_DIR = process.env.MIDEN_CLIENT_CACHE_DIR ?? "/cache";

// How long one helper tool may run. Assembling and reading a package take
// milliseconds; `miden-import` and `miden-verifier` call the resource's
// network, which takes a second or two. This only trips when one is stuck.
export const MIDEN_TOOL_TIMEOUT_MS = 30_000;

// Builds (lib/assemble.ts): a few run at once, more wait, the rest get a 503.
// The deadline bounds one request's tools together, answered with a 504: most
// of it is for the verifier's network call.
export const ASSEMBLE_DEADLINE_MS = Number(process.env.ASSEMBLE_DEADLINE_MS ?? 45_000);
export const ASSEMBLE_CONCURRENCY = Number(process.env.ASSEMBLE_CONCURRENCY ?? 4);
export const ASSEMBLE_QUEUE_SIZE = Number(process.env.ASSEMBLE_QUEUE_SIZE ?? 16);

// An import is a `miden-import` run: a second or so, a connection to the node
// and a write to the network's client store. A few at once are fine; a burst
// of them would start one process each on a single container.
export const IMPORT_CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY ?? 4);
export const IMPORT_QUEUE_SIZE = Number(process.env.IMPORT_QUEUE_SIZE ?? 16);

// How long in-flight requests get to finish on SIGTERM: above the deadline, so
// a request that started still gets its answer, and well below the 15 minutes
// Cloudflare waits during a rollout before it kills the container.
export const SHUTDOWN_TIMEOUT_MS = 60_000;

// The most a subprocess may print on stdout or on stderr. Node stops at 1 MiB
// when nothing is set, which a build with many warnings could exceed; past
// this limit the subprocess is ended and the call fails.
export const SUBPROCESS_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// The user the helper tools run as (both unset: the server's own, for running
// on the host). The server stays root to write each request's files and hand
// them over; the tools own the client stores. See
// docs/adr/0007-masm-builds-run-no-project-code.md.
export const API_USER =
  process.env.API_UID !== undefined && process.env.API_GID !== undefined
    ? { uid: Number(process.env.API_UID), gid: Number(process.env.API_GID) }
    : undefined;
// Where each request's directories go.
export const WORK_DIR = process.env.WORK_DIR ?? tmpdir();
