import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "@/db/relations.js";
import { DATABASE_URL } from "@/lib/constants.js";

const db = drizzle(DATABASE_URL, {
  relations,
});

export default db;
