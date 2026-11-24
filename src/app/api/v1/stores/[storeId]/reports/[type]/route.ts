import { ok, storeRoute } from "@/server/http";
import { storeToday } from "@/server/services/dashboard";
import { runReport, toCsv } from "@/server/services/reports";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]. Dates default to today (store timezone). */
export const GET = storeRoute<{ storeId: string; type: string }>(async (req, { store, params }) => {
  const sp = req.nextUrl.searchParams;
  const today = await storeToday(store);
  const report = await runReport(store, params.type, { from: sp.get("from") ?? today, to: sp.get("to") ?? sp.get("from") ?? today });
  if (sp.get("format") === "csv") {
    const name = `kwaderno-${report.type}-${sp.get("from") ?? today}${report.dated && sp.get("to") ? `_${sp.get("to")}` : ""}.csv`;
    return new Response(toCsv(report), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  }
  return ok(report);
});
