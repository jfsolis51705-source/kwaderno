import { afterAll, beforeEach } from "vitest";
import { getPool } from "@/db";
import { resetRateLimits } from "@/server/rate-limit";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kwaderno:kwaderno@localhost:5432/kwaderno_test";
process.env.UPLOAD_DIR ??= "./storage/test-uploads";
process.env.RECEIPT_AUTO_PROCESS = "0"; // tests drive processing explicitly with a fake extractor

beforeEach(async () => {
  resetRateLimits();
  const { rows } = await getPool().query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  if (rows.length) await getPool().query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
});

afterAll(async () => {
  await getPool().end();
  (globalThis as { __kwPool?: unknown; __kwDb?: unknown }).__kwPool = undefined;
  (globalThis as { __kwDb?: unknown }).__kwDb = undefined;
});
