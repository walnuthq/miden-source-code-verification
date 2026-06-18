import { httpServerHandler } from "cloudflare:node";
import { createApp } from "miden-source-code-verification-api-registry/app";
import { createDb } from "miden-source-code-verification-api-registry/db";

// Cloudflare Workers entrypoint: run the vendor-neutral Express app from
// `miden-source-code-verification-api-registry` on top of the Workers Node-compat
// HTTP server.
//
// Workers cannot reuse a database connection across requests (a socket is bound
// to the I/O context of the request that opened it), so we open a fresh
// connection per request through Hyperdrive and let the app dispose it when the
// response closes. Hyperdrive keeps the upstream Postgres connections warm at the
// edge, so this stays cheap and avoids exhausting the origin database.
const PORT = Number(process.env.PORT ?? "8081");

// `env` (and therefore the Hyperdrive binding) is only available per request,
// not at module load. Capture the connection string on first request — it is
// stable for the lifetime of the isolate.
let connectionString: string | undefined;

const app = createApp({
  requestDbFactory: () => {
    if (!connectionString) {
      throw new Error("Hyperdrive connection string not initialized");
    }
    return createDb(connectionString);
  },
});
app.listen(PORT);

const { fetch: fetchHandler } = httpServerHandler({ port: PORT });
if (!fetchHandler) {
  throw new Error("httpServerHandler did not provide a fetch handler");
}

export default {
  fetch(request, env, ctx) {
    connectionString ??= env.HYPERDRIVE.connectionString;
    return fetchHandler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
