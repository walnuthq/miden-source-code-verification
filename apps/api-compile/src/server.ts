import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  PORT,
  ALLOWED_ORIGINS,
  CARGO_TARGET_DIR,
  MIDEN_VERIFIER_CACHE_DIR,
} from "@/lib/constants.js";
import { cargoMidenVersion } from "@/lib/cargo-miden.js";
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

app.get("/", async (req, res) => {
  res.json({
    timestamp: Date.now(),
    env: { PORT, ALLOWED_ORIGINS, CARGO_TARGET_DIR, MIDEN_VERIFIER_CACHE_DIR },
    cargoMidenVersion: await cargoMidenVersion(),
  });
});

app.use(compileRouter);
app.use(verifyRouter);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
