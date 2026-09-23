import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests run without the React Router plugin,
// which only builds and serves the app.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
