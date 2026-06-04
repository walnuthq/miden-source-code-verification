import cors from "cors";
import express from "express";
import { cargoMidenVersion } from "@/lib/cargo-miden.js";
import {
  ALLOWED_ORIGINS,
  CARGO_TARGET_DIR,
  MIDEN_VERIFIER_CACHE_DIR,
  PORT,
} from "@/lib/constants.js";
import compileRouter from "@/routes/compile.js";
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

app.use(express.json({ limit: "1mb" }));

app.get("/", async (_req, res) => {
  res.json({
    timestamp: Date.now(),
    env: { PORT, ALLOWED_ORIGINS, CARGO_TARGET_DIR, MIDEN_VERIFIER_CACHE_DIR },
    cargoMidenVersion: await cargoMidenVersion(),
  });
});

app.use(compileRouter);
app.use(verifyRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
