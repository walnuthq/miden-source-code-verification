// Cloudflare Workers entrypoint for the web-verifier SPA.
//
// The build output of `miden-source-code-verification-web-verifier` is served from the static
// assets binding. The Worker runs in front of the assets (`run_worker_first`)
// so it can attach the COOP/COEP headers the Miden SDK requires for cross-origin
// isolation (SharedArrayBuffer / WASM threads) — the production equivalent of
// the dev-only headers set by `midenVitePlugin({ crossOriginIsolation: true })`.
export default {
  async fetch(request, env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
