import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

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

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  const container = getContainer(c.env.COMPILER);
  return container.fetch(c.req.raw);
});

app.post("/compile", (c) => {
  const container = getContainer(c.env.COMPILER);
  return container.fetch(c.req.raw);
});

app.post("/verify", (c) => {
  const container = getContainer(c.env.COMPILER);
  return container.fetch(c.req.raw);
});

export default app;
