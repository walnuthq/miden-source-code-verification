import { httpServerHandler } from "cloudflare:node";
import { createApp } from "miden-source-code-verification-api-registry/app";

// Cloudflare Workers entrypoint: run the vendor-neutral Express app from
// `miden-source-code-verification-api-registry` on top of the Workers Node-compat HTTP server.
const PORT = Number(process.env.PORT ?? "8081");

const app = createApp();
app.listen(PORT);

export default httpServerHandler({ port: PORT });
