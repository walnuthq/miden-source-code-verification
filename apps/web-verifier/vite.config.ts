import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // packages/ui ships raw .tsx that imports itself via `@ui`. Vite has to
      // resolve those to the package source, not to this app's `@` -> ./src.
      "@ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
});
