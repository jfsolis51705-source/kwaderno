import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

const globalForDb = globalThis as unknown as { __kwPool?: Pool; __kwDb?: DB };

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  return url;
}

export function getPool(): Pool {
  if (!globalForDb.__kwPool) {
    globalForDb.__kwPool = new Pool({ connectionString: databaseUrl(), max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return globalForDb.__kwPool;
}

export function getDb(): DB {
  if (!globalForDb.__kwDb) globalForDb.__kwDb = drizzle(getPool(), { schema, casing: "snake_case" });
  return globalForDb.__kwDb;
}

export { schema };
