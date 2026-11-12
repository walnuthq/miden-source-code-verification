import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = process.env.PORT ?? "8080";
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";
export const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "/cache/target";
export const CARGO_HOME = process.env.CARGO_HOME;
// The image's warm cache, read-only to the build user: `target` and
// `cargo-home`, built at CARGO_TARGET_DIR and CARGO_HOME, then moved here.
// Each build gets a fresh copy of both back at those paths (compile.ts), so
// nothing a build changes reaches a later one. Unset on the host, where builds
// use CARGO_TARGET_DIR and CARGO_HOME directly.
export const WARM_CACHE_DIR = process.env.WARM_CACHE_DIR;
// The two directories in it, so their names live in one place. An empty
// WARM_CACHE_DIR counts as unset.
export const WARM_TARGET_DIR = WARM_CACHE_DIR
  ? join(WARM_CACHE_DIR, "target")
  : undefined;
export const WARM_CARGO_HOME = WARM_CACHE_DIR
  ? join(WARM_CACHE_DIR, "cargo-home")
  : undefined;
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

// In the image, every build replaces the one copy of the warm cache at fixed
// paths, so builds must run one at a time (the host's CARGO_TARGET_DIR lock
// also serializes them). Queue a few more and turn the rest away with a 503,
// rather than pile up waiting builds until the container stops answering. It
// must stay 1 when builds run as BUILD_USER: compile.ts refuses to start
// otherwise.
export const COMPILE_CONCURRENCY = Number(process.env.COMPILE_CONCURRENCY ?? 1);
export const COMPILE_QUEUE_SIZE = Number(process.env.COMPILE_QUEUE_SIZE ?? 8);

// An import is a `miden-import` run: a second or so, a connection to the node
// and a write to the network's client store. A few at once are fine; a burst
// of them would start one process each on a single container.
export const IMPORT_CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY ?? 4);
export const IMPORT_QUEUE_SIZE = Number(process.env.IMPORT_QUEUE_SIZE ?? 16);

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

// The most a subprocess may print on stdout or on stderr. Node stops at 1 MiB
// when nothing is set, which a build with many warnings exceeds; past this
// limit the subprocess is ended and the call fails.
export const SUBPROCESS_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// Build isolation. Compiling a project runs its own code (`build.rs`,
// procedural macros), so the server, which stays root, starts cargo as
// `BUILD_USER` and the helper tools as `API_USER` (both unset: no switching,
// for running on the host). What build code can write is then its own project
// directory and the build's copies of CARGO_TARGET_DIR / CARGO_HOME, which are
// replaced before each build, nothing the helper tools or the toolchain are
// made of. See docs/adr/0006-build-isolation.md.
const idsFrom = (prefix: string) =>
  process.env[`${prefix}_UID`] !== undefined &&
  process.env[`${prefix}_GID`] !== undefined
    ? {
        uid: Number(process.env[`${prefix}_UID`]),
        gid: Number(process.env[`${prefix}_GID`]),
      }
    : undefined;
export const BUILD_USER = idsFrom("BUILD");
export const API_USER = idsFrom("API");
// Where each request's directories go. Build code can write only the project
// directory under it that the server hands to `BUILD_USER`, not the parent.
export const WORK_DIR = process.env.WORK_DIR ?? tmpdir();
