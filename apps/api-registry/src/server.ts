import express from "express";
import cors from "cors";
import { PORT, ALLOWED_ORIGINS, API_COMPILE_URL } from "@/lib/constants.js";
import verifiedAccountsRouterV1 from "@/routes/v1/verified-accounts.js";
import verifiedNotesRouterV1 from "@/routes/v1/verified-notes.js";

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

app.get("/", (req, res) => {
  res.json({
    timestamp: Date.now(),
    env: { PORT, ALLOWED_ORIGINS, API_COMPILE_URL },
  });
});

app.use("/v1", verifiedAccountsRouterV1);
app.use("/v1", verifiedNotesRouterV1);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
