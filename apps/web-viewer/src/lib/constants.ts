// The sibling web-verifier app, linked from the navbar. Baked in at build time
// (unlike constants.server.ts) so both the server and client bundles have it,
// including on the 404 page, which renders without any loader data.
export const WEB_VERIFIER_URL =
  import.meta.env.VITE_WEB_VERIFIER_URL ?? "http://localhost:5173";
