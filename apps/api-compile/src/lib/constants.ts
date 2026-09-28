import "dotenv/config";

export const PORT = process.env.PORT ?? "8080";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "/cache/target";
export const MIDEN_CLIENT_CACHE_DIR =
  process.env.MIDEN_CLIENT_CACHE_DIR ?? "/cache";

// Subprocess timeouts. A build against the warm cache takes seconds, and the
// other tools about one; these only trip when something is stuck.
export const CARGO_MIDEN_BUILD_TIMEOUT_MS = 240_000;
export const MIDEN_TOOL_TIMEOUT_MS = 60_000;

// Builds share CARGO_TARGET_DIR, whose lock makes cargo run them one at a time
// anyway. Queue a few more and turn the rest away with a 503, rather than pile
// up waiting builds until the container stops answering.
export const COMPILE_CONCURRENCY = Number(process.env.COMPILE_CONCURRENCY ?? 1);
export const COMPILE_QUEUE_SIZE = Number(process.env.COMPILE_QUEUE_SIZE ?? 8);

// How long in-flight requests get to finish on SIGTERM. It must stay below the
// 15 minutes Cloudflare waits during a rollout before it kills the container.
export const SHUTDOWN_TIMEOUT_MS = 600_000;
