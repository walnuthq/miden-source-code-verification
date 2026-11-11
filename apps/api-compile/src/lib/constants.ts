export const PORT = process.env.PORT ?? "8080";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "/cache/target";
// The lockfile the image warmed cargo's cache with (see the Dockerfile): the
// crate versions an offline build finds. `GET /lockfile` serves it, so clients
// that send their own lockfile can keep it in step.
export const WARM_CARGO_LOCK =
  process.env.WARM_CARGO_LOCK ??
  "/cache/examples/counter-contract/counter-contract/Cargo.lock";
export const MIDEN_CLIENT_CACHE_DIR =
  process.env.MIDEN_CLIENT_CACHE_DIR ?? "/cache";

// Subprocess timeouts. A build against the warm cache takes seconds, and the
// other tools about one; these only trip when something is stuck.
export const CARGO_MIDEN_BUILD_TIMEOUT_MS = 240_000;
export const MIDEN_TOOL_TIMEOUT_MS = 60_000;

// How long one request may hold the build slot, all its subprocesses together:
// the offline build, its online retry, the debug build and the tools after
// them. Below the 420 s the Cloudflare Worker in front of the container allows,
// so the caller gets this 504 rather than the Worker's.
export const COMPILE_DEADLINE_MS = 400_000;

// Builds share CARGO_TARGET_DIR, whose lock makes cargo run them one at a time
// anyway. Queue a few more and turn the rest away with a 503, rather than pile
// up waiting builds until the container stops answering.
export const COMPILE_CONCURRENCY = Number(process.env.COMPILE_CONCURRENCY ?? 1);
export const COMPILE_QUEUE_SIZE = Number(process.env.COMPILE_QUEUE_SIZE ?? 8);

// How long in-flight requests get to finish on SIGTERM. It must stay below the
// 15 minutes Cloudflare waits during a rollout before it kills the container.
export const SHUTDOWN_TIMEOUT_MS = 600_000;

// A debug build is ~100× its release build (1.8 MB for the counter). Larger
// ones are dropped: the debugger can't load a package whose debug info is over
// 16 MiB (0xMiden/compiler#1430), and the registry holds the whole response in
// a Worker's memory.
export const MAX_DEBUG_MASP_BYTES = 16 * 1024 * 1024;

// The Miden Assembly `POST /compile` returns with `masm: true` is ~40 KB for
// the counter, most of it Wasm glue. Larger ones are left out of the response,
// which the registry holds in a Worker's memory.
export const MAX_MASM_BYTES = 4 * 1024 * 1024;
