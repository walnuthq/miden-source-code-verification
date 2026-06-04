import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["./__tests__/setup.ts"],
    // Test files share one database; run them serially so the per-test
    // TRUNCATE in setup.ts can't wipe rows another file is using.
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
