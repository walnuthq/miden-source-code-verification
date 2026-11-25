// Routes do not catch: an error a route handler raises propagates to the
// shared errorHandler (CODING_STANDARDS.md, "Routes throw, the error handler
// answers"). A `try`/`finally` that releases a resource stays allowed.

const message =
  "Routes do not catch: throw, or let the error propagate to the shared errorHandler (CODING_STANDARDS.md, section 'Routes throw, the error handler answers').";

export default {
  meta: { name: "miden" },
  rules: {
    "no-route-catch": {
      create: (context) => ({
        TryStatement: (node) => {
          if (node.handler !== null) {
            context.report({ node, message });
          }
        },
      }),
    },
  },
};
