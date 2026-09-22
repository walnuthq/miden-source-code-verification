import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://reactrouter.com/start/framework/installation
export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // packages/ui ships raw .tsx that imports itself via `@ui`. Vite has to
      // resolve those to the package source, not to this app's `@` -> ./src.
      "@ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  ssr: {
    // The server build must compile packages/ui's raw .tsx rather than leave it
    // as a bare import for Node to load at runtime. Same for packages/utils in
    // dev, where its `development` export condition resolves to raw .ts.
    noExternal: [
      "miden-source-code-verification-ui",
      "miden-source-code-verification-utils",
    ],
  },
  // web-verifier owns Vite's default 5173.
  server: { port: 5174 },
});
