import * as build from "miden-source-code-verification-web-viewer/server";
import { createRequestHandler } from "react-router";

// Cloudflare Workers entrypoint for the web-viewer: server-render the
// vendor-neutral React Router build from `miden-source-code-verification-web-viewer`.
// Static assets (build/client) never reach this; wrangler.jsonc serves them.
const handleRequest = createRequestHandler(build);

export default {
  fetch(request) {
    return handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
