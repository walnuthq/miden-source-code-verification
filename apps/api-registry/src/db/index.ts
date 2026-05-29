import { drizzle } from "drizzle-orm/node-postgres";
import { DATABASE_URL } from "@/lib/constants.js";
import { relations } from "@/db/relations.js";

const db = drizzle(DATABASE_URL, {
  relations,
});

export default db;
