// Re-export the database from the request-context module. Keeping this barrel
// means every `import db from "./index.ts"` call site stays unchanged.
export { createDb, type Database, dbScope, default } from "./context.ts";
