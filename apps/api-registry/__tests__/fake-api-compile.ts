import type { ApiCompile } from "../src/lib/api-compile.ts";

// An api-compile for in-process tests, passed to `createApp` or
// `verifyResource` in place of the one over HTTP. Each call answers as set up;
// one nothing was set up for rejects, which fails the test that made it.
export const fakeApiCompile = (
  calls: Partial<ApiCompile> = {},
): ApiCompile => ({
  verify: () => Promise.reject(new Error("verify was not expected")),
  importResource: () =>
    Promise.reject(new Error("importResource was not expected")),
  compileDebug: () =>
    Promise.reject(new Error("compileDebug was not expected")),
  ...calls,
});
