import fs from "node:fs";
import path from "node:path";
import { getAbsoluteFSPath } from "swagger-ui-dist";
import { openapiSpec } from "@/lib/openapi.js";

// Builds a self-contained static Swagger UI site into `dist/`, suitable for
// hosting on GitHub Pages (or any static host). No server is involved at
// runtime — the OpenAPI document is generated here, at build time, by scanning
// the api-registry source.

const outDir = path.resolve(import.meta.dirname, "..", "dist");

// Start from a clean output directory.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Vendor the Swagger UI assets (HTML, CSS, JS) from the npm package.
fs.cpSync(getAbsoluteFSPath(), outDir, { recursive: true });

// Write the generated OpenAPI document next to the UI.
fs.writeFileSync(
  path.join(outDir, "openapi.json"),
  JSON.stringify(openapiSpec, null, 2),
);

// Replace the default initializer (which loads the Petstore demo) with one that
// loads our spec via a relative URL, so it works under any Pages base path.
const initializer = `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: "./openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: "StandaloneLayout",
  });
};
`;
fs.writeFileSync(path.join(outDir, "swagger-initializer.js"), initializer);

const { paths } = openapiSpec as { paths?: Record<string, unknown> };
const pathCount = Object.keys(paths ?? {}).length;
console.log(`Built static docs to ${outDir} (${pathCount} paths).`);
