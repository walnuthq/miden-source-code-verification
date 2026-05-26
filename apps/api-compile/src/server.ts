import express from "express";
import cors from "cors";
import { cargoMidenVersion } from "@/lib/cargo-miden.js";
import { compile } from "@/lib/compile.js";
// import { verify } from "@/lib/verify.js";

const app = express();

const PORT = process.env.PORT ?? "8080";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";

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
    env: { PORT, ALLOWED_ORIGINS },
    cargoMidenVersion: await cargoMidenVersion(),
  });
});

app.post("/compile", async (req, res) => {
  const { files, entrypoint } = req.body as {
    files?: Record<string, string>;
    entrypoint?: string;
  };
  if (!files || typeof files !== "object") {
    res.status(400).json({ error: "Missing files object" });
    return;
  }
  const cargoTomlPath = entrypoint ? `${entrypoint}/Cargo.toml` : "Cargo.toml";
  if (!files[cargoTomlPath]) {
    res.status(400).json({ error: "Missing Cargo.toml" });
    return;
  }
  try {
    const { stdout, stderr, masp, digest, manifest } = await compile({
      files,
      entrypoint,
    });
    res.json({ stdout, stderr, masp, digest, manifest });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Compilation failed";
    res.status(500).json({ error: message });
  }
});

// app.post("/verify", async (req, res) => {
//   const { files, entrypoint, resourceId, resourcePath } = req.body as {
//     files?: Record<string, string>;
//     entrypoint?: string;
//     resourceId?: string;
//     resourcePath?: string;
//   };
//   if (!files || typeof files !== "object") {
//     res.status(400).json({ error: "Missing files object" });
//     return;
//   }
//   const cargoTomlPath = entrypoint ? `${entrypoint}/Cargo.toml` : "Cargo.toml";
//   if (!files[cargoTomlPath]) {
//     res.status(400).json({ error: "Missing Cargo.toml" });
//     return;
//   }
//   if (!resourceId) {
//     res.status(400).json({ error: "Missing resource ID" });
//     return;
//   }
//   try {
//     const { stdout, stderr, masp, digest, manifest } = await compile({
//       files,
//       entrypoint,
//     });
//     const verified = await verify({ resourceId, maspPath: "", resourcePath });
//     res.json({ verified });
//   } catch (error) {
//     console.error(error);
//     const message =
//       error instanceof Error ? error.message : "Verification failed";
//     res.status(500).json({ error: message });
//   }
// });

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
