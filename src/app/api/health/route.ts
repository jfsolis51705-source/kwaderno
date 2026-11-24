import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getPool } from "@/db";

/** Liveness/readiness for load balancers and uptime checks. Reveals no data. */
export async function GET() {
  await connection();
  const started = Date.now();
  let db = false;
  try {
    await getPool().query("select 1");
    db = true;
  } catch {
    db = false;
  }
  let ai: "ok" | "down" | "not_configured" = "not_configured";
  if (process.env.AI_SERVICE_URL) {
    try {
      const r = await fetch(new URL("/health", process.env.AI_SERVICE_URL), { signal: AbortSignal.timeout(2000) });
      ai = r.ok ? "ok" : "down";
    } catch {
      ai = "down";
    }
  }
  // AI is optional: the app is healthy without it (manual inventory keeps working).
  return NextResponse.json({ ok: db, db, ai, ms: Date.now() - started }, { status: db ? 200 : 503, headers: { "cache-control": "no-store" } });
}
