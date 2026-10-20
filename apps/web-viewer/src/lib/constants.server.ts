// Read at runtime on the server (loaders), never baked into the client bundle:
// the server fetches the pages' data. The browser only follows the Download
// MASP links, to PUBLIC_API_REGISTRY_URL (constants.ts).
export const API_REGISTRY_URL =
  process.env.API_REGISTRY_URL ?? "http://localhost:8081";
