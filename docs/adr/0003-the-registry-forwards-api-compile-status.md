# The registry forwards api-compile's status and message

When api-compile answers an error, the registry answers the same status with the same message, whatever the status is (PR #90). So `POST /v1/{networkId}/verified-accounts` and `verified-notes` answer 400 for a project that doesn't build or a resource that isn't on chain, as api-compile does. The registry's own outcomes sit beside them: 409 for an already verified root (PR #91); 502, 503 with `Retry-After`, or 504 for an outage (README "Outages are reported as outages"); a 500 keeps `error.message`, except a failed database query, which answers `database query failed`: Drizzle's message is the SQL text and its parameters (`apps/api-registry/src/lib/query-errors.ts`). One rule decides the status, and a client reads the same status and message from either API.

## Considered Options

- **Forward only 502–504, answer 500 for anything else.** This was the behaviour before PR #90. Rejected: it reported a client's own mistake, a failing build, as a registry failure.
