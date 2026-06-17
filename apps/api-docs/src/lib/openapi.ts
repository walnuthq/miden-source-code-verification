import fs from "node:fs";
import path from "node:path";
import swaggerJSDoc from "swagger-jsdoc";
import { API_REGISTRY_URL } from "@/lib/constants.js";

// Walk up from this file until we find the monorepo root (the directory that
// holds `pnpm-workspace.yaml`). This keeps the source globs below valid whether
// the server is run from source (tsx) or from a built `dist/` directory.
const findRepoRoot = (start: string): string => {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the monorepo root from ${start}`);
    }
    dir = parent;
  }
};

const appsDir = path.join(findRepoRoot(import.meta.dirname), "apps");

// swagger-jsdoc parses the `@openapi` (a.k.a. `@swagger`) JSDoc blocks found in
// these source files. api-registry keeps its docs next to its route handlers,
// so the documentation stays in sync with the code it describes.
const apis = [
  path.join(appsDir, "api-registry/src/app.ts"),
  path.join(appsDir, "api-registry/src/routes/**/*.ts"),
];

export const openapiSpec = swaggerJSDoc({
  definition: {
    openapi: "3.1.0",
    info: {
      title: "Miden Source Code Verification Registry API",
      version: "0.1.0",
      description:
        "API documentation for the Miden Source Code Verification `api-registry` service " +
        "(verified account & note registry).",
    },
    servers: [{ url: API_REGISTRY_URL, description: "api-registry" }],
    tags: [
      {
        name: "verified-accounts",
        description: "Verified account component endpoints",
      },
      { name: "verified-notes", description: "Verified note endpoints" },
    ],
  },
  apis,
});
