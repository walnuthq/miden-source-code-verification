import cors from "cors";
import express from "express";
import { cargoMidenVersion } from "@/lib/cargo-miden.js";
import {
  ALLOWED_ORIGINS,
  CARGO_TARGET_DIR,
  MIDEN_CLIENT_CACHE_DIR,
  PORT,
  SHUTDOWN_TIMEOUT_MS,
} from "@/lib/constants.js";
import { errorHandler, notFound } from "@/lib/errors.js";
import compileRouter from "@/routes/compile.js";
import importRouter from "@/routes/import.js";
import verifyRouter from "@/routes/verify.js";

const app = express();

const allowedOrigins = ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  }),
);

// Once SIGTERM arrives, refuse new requests (including on kept-alive
// connections) while the in-flight ones finish.
let shuttingDown = false;
app.use((_req, res, next) => {
  if (shuttingDown) {
    res.set("Connection", "close").status(503).json({ error: "shutting down" });
    return;
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

// `/` is the health probe, so it must not run cargo on every request: a stuck
// or starved toolchain would make a healthy server look down. Resolve the
// version once, at startup.
const cargoMidenVersionPromise = cargoMidenVersion().catch((error) => {
  console.error(error);
  return null;
});

app.get("/", async (_req, res) => {
  res.json({
    timestamp: Date.now(),
    env: {
      PORT,
      ALLOWED_ORIGINS,
      CARGO_TARGET_DIR,
      MIDEN_CLIENT_CACHE_DIR,
    },
    cargoMidenVersion: await cargoMidenVersionPromise,
  });
});

app.use(compileRouter);
app.use(verifyRouter);
app.use(importRouter);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Node ignores SIGTERM when it runs as PID 1, as it does in the container, so
// without this a rollout waits out its 15-minute grace period and then kills
// the server with requests in flight.
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received, finishing in-flight requests`);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    console.error("In-flight requests did not finish in time, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
