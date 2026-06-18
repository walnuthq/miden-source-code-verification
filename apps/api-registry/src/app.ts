import cors from "cors";
import express, { type Express } from "express";
import { type Database, dbScope } from "@/db/context.js";
import { ALLOWED_ORIGINS, API_COMPILE_URL, PORT } from "@/lib/constants.js";
import verifiedAccountsRouterV1 from "@/routes/v1/verified-accounts.js";
import verifiedNotesRouterV1 from "@/routes/v1/verified-notes.js";

type CreateAppOptions = {
  /**
   * When provided, every request runs inside its own database connection built
   * by this factory and disposed when the response closes. Deployments that
   * cannot share a connection across requests (e.g. Cloudflare Workers) supply
   * this; the default Node server omits it and keeps the shared singleton.
   */
  requestDbFactory?: () => Database;
};

export const createApp = ({
  requestDbFactory,
}: CreateAppOptions = {}): Express => {
  const app = express();

  // Must run before the routers so the request-scoped db is set for the whole
  // handler chain. No-op unless a factory is supplied.
  if (requestDbFactory) {
    app.use((_req, res, next) => {
      const db = requestDbFactory();
      res.once("close", () => {
        void db.$client.end().catch(() => {});
      });
      dbScope.run(db, next);
    });
  }

  const allowedOrigins = ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(
    cors({
      origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      timestamp: Date.now(),
      env: { PORT, ALLOWED_ORIGINS, API_COMPILE_URL },
    });
  });

  app.use("/v1", verifiedAccountsRouterV1);
  app.use("/v1", verifiedNotesRouterV1);

  return app;
};
