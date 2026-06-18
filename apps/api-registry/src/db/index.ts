// Re-export the database from the request-context module. Keeping this barrel
// means every `import db from "@/db/index.js"` call site stays unchanged.
export { createDb, type Database, dbScope, default } from "@/db/context.js";
