import { defineConfig } from "vitest/config";

// The test files that need neither Postgres nor a running registry, so CI can
// run them: no setup file, unlike vitest.config.ts, whose setup connects to the
// database and truncates it before every test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/api-compile.test.ts", "__tests__/masp-store.test.ts"],
  },
});
