// Read at runtime on the server (loaders), never baked into the client bundle:
// the server fetches the pages' data. The browser only follows the Download
// MASP links, to PUBLIC_API_REGISTRY_URL (constants.ts).
export const API_REGISTRY_URL =
  process.env.API_REGISTRY_URL ?? "http://localhost:8081";

// The registry's lookup by id waits on api-compile for up to 120 s (a cold
// container takes about 50 s to start) before answering 504 itself. Just past
// that, so its own answer normally arrives first. Follows
// `API_COMPILE_IMPORT_TIMEOUT_MS` (apps/api-registry/src/lib/constants.ts, used
// by apps/api-registry/src/lib/api-compile.ts).
export const API_REGISTRY_TIMEOUT_MS = 125_000;
