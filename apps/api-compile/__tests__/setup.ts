import { existsSync } from "node:fs";

// Like the dev scripts' --env-file-if-exists=.env: shell variables win.
if (existsSync(".env")) process.loadEnvFile();
