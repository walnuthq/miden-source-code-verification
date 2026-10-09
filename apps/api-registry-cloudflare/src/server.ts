import { httpServerHandler } from "cloudflare:node";
import { createApp } from "miden-source-code-verification-api-registry/app";
import { createDb } from "miden-source-code-verification-api-registry/db";
import { createR2MaspStore } from "./r2-masp-store";

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

// `env` (and therefore the Hyperdrive and R2 bindings) is only available per
// request, not at module load. Capture them on first request — they are stable
// for the lifetime of the isolate.
let connectionString: string | undefined;
let maspBucket: R2Bucket | undefined;

const app = createApp({
  requestDbFactory: () => {
    if (!connectionString) {
      throw new Error("Hyperdrive connection string not initialized");
    }
    return createDb(connectionString);
  },
  maspStore: createR2MaspStore(() => {
    if (!maspBucket) {
      throw new Error("R2 MASP bucket not initialized");
    }
    return maspBucket;
  }),
});
app.listen(PORT);

const { fetch: fetchHandler } = httpServerHandler({ port: PORT });
if (!fetchHandler) {
  throw new Error("httpServerHandler did not provide a fetch handler");
}

export default {
  fetch(request, env, ctx) {
    connectionString ??= env.HYPERDRIVE.connectionString;
    maspBucket ??= env.MASP_BUCKET;
    return fetchHandler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
