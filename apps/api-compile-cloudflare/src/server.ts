import { Container, getContainer } from "@cloudflare/containers";
import { type Context, Hono } from "hono";

export class Compiler extends Container<Env> {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "5m";
  // Environment variables passed to the container
  envVars = { PORT: "8080" };

  // Optional lifecycle hooks
  override onStart() {
    console.log("Container successfully started");
  }

  override onStop() {
    console.log("Container successfully shut down");
  }

  override onError(error: unknown) {
    console.log("Container error:", error);
  }
}

// How long the container gets to answer each kind of request. api-compile
// times out its own subprocesses well below these, so they only trip when the
// container itself stops answering. The caller then gets a 504 instead of
// hanging. `/` and imports allow for a cold start (about 50s).
const HEALTH_TIMEOUT_MS = 90_000;
const IMPORT_TIMEOUT_MS = 120_000;
const COMPILE_TIMEOUT_MS = 420_000;

const proxy =
  (timeoutMs: number) =>
  async (c: Context<{ Bindings: Env }>): Promise<Response> => {
    const container = getContainer(c.env.COMPILER);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      const response = await Promise.race([
        container.fetch(c.req.raw),
        timeout,
      ]);
      return (
        response ??
        c.json(
          { error: `api-compile did not answer within ${timeoutMs / 1000}s` },
          504,
        )
      );
    } finally {
      clearTimeout(timer);
    }
  };

const app = new Hono<{ Bindings: Env }>();

app.get("/", proxy(HEALTH_TIMEOUT_MS));
app.post("/compile", proxy(COMPILE_TIMEOUT_MS));
app.get("/:networkId/import/:resourceId", proxy(IMPORT_TIMEOUT_MS));
app.post("/verify", proxy(COMPILE_TIMEOUT_MS));

// The same JSON errors api-compile answers itself, for paths the Worker doesn't
// forward and for failures in the Worker (Hono's defaults are plain text).
app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "internal error" }, 500);
});

export default app;
