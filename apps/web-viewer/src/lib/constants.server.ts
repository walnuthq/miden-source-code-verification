// Read at runtime on the server (loaders), never baked into the client bundle —
// the browser doesn't call the registry, the server does.
export const API_REGISTRY_URL =
  process.env.API_REGISTRY_URL ?? "http://localhost:8081";
