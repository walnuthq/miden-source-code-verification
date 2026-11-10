import { AsyncLocalStorage } from "node:async_hooks";
import { DrizzleQueryError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "../lib/constants.ts";
import { DatabaseConnectionError } from "../lib/query-errors.ts";
import { relations } from "./relations.ts";

/**
 * Build a fresh Drizzle instance backed by its own `pg.Pool`.
 *
 * Most deployments share a single long-lived instance (see the singleton
 * below). Deployments that cannot share a connection across requests — notably
 * serverless runtimes where a socket is bound to the I/O context of the request
 * that opened it — call this per request instead and run their handlers inside
 * {@link dbScope}. `max: 1` keeps each such request to a single connection.
 */
export const createDb = (connectionString: string = DATABASE_URL) => {
  const db = drizzle({
    client: new Pool({ connectionString, max: 1 }),
    relations,
  });
  // Drizzle's node-postgres `transaction` takes a pool client before its own
  // `try`, so a failed connection rejects with the driver's error (`connect
  // ECONNREFUSED <host>:<port>`), not a DrizzleQueryError. Whatever rejects
  // before the callback starts, other than a failed `begin` (a
  // DrizzleQueryError), is that failure.
  const transaction = db.transaction.bind(db);
  db.transaction = async (callback, config) => {
    let started = false;
    try {
      return await transaction((tx) => {
        started = true;
        return callback(tx);
      }, config);
    } catch (error) {
      if (started || error instanceof DrizzleQueryError) {
        throw error;
      }
      throw new DatabaseConnectionError({ cause: error });
    }
  };
  return db;
};

export type Database = ReturnType<typeof createDb>;

/**
 * Optional request-scoped database override. When a store is set (by a caller
 * that runs each request inside `dbScope.run(...)`), the default export resolves
 * to it; otherwise it falls back to the process-wide singleton. This is a
 * generic request-context mechanism and carries no runtime cost when unused.
 */
export const dbScope = new AsyncLocalStorage<Database>();

let singleton: Database | undefined;

const getDb = (): Database => {
  const scoped = dbScope.getStore();
  if (scoped) {
    return scoped;
  }
  singleton ??= createDb();
  return singleton;
};

/**
 * Proxy so existing `import db from "./index.ts"` call sites keep working
 * unchanged while the underlying instance is resolved per access — request
 * scoped when a store is set, singleton otherwise.
 */
const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance as object, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export default db;
