import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page is published under a subpath of the GitHub Pages site (api-docs owns
// the root), so every asset URL needs that prefix baked in. Overridable so
// `vite preview` and other hosts can serve it from the root instead.
const base =
  process.env.STATUS_PAGE_BASE ?? "/miden-source-code-verification/status/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // packages/ui ships raw .tsx that imports itself via `@ui`. Vite has to
      // resolve those to the package source, not to this app's `@` -> ./src.
      "@ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
});
