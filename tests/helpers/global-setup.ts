import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://kwaderno:kwaderno@localhost:5432/kwaderno_test";
  const pool = new Pool({ connectionString: url, max: 1 });
  // Fresh schema every run so migrations themselves are tested.
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
