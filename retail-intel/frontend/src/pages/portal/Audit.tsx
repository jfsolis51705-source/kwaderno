import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ISSUE_TEXT, when } from "../../lib/format";
import type { AuditEntry, Capture } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

const ACTION_TEXT: Record<string, string> = {
  capture_received: "Photo received", capture_verified: "Photo verified", capture_rejected: "Photo rejected", stock_adjusted: "Stock adjusted",
  product_created: "Product added", product_updated: "Product edited", thumbnail_updated: "Product photo changed", order_drafted: "Order drafted",
  order_updated: "Order edited", order_submitted: "Order submitted", order_fulfilled: "Order fulfilled", order_cancelled: "Order cancelled", store_created: "Store added",
};

export default function AuditLog() {
  const { stores, toast } = useApp();
  const [caps, setCaps] = useState<Capture[]>([]);
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const names = new Map(stores.map((s) => [s.id, s.name]));
  const load = useCallback(async () => { try { const [c, a] = await Promise.all([api.captures(), api.audit()]); setCaps(c); setLog(a); } catch (e) { toast((e as Error).message, "err"); } }, [toast]);
  useEffect(() => { load(); }, [load]);
  const shown = caps.filter((c) => !flaggedOnly || c.duplicate_of || !c.quality_ok || c.status === "pending_review");
  const approve = async (c: Capture) => { try { const r = await api.confirmCapture(c.id, c.items, true); toast(`Verified #${c.id} (+${r.points_awarded} pts)`); load(); } catch (e) { toast((e as Error).message, "err"); } };
  const reject = async (c: Capture) => { try { await api.rejectCapture(c.id, "Rejected by operations"); toast(`Rejected #${c.id}`); load(); } catch (e) { toast((e as Error).message, "err"); } };
  return (
    <div className="grid gap-6">
      <section className="card overflow-x-auto">
        <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="flex-1 font-bold">Capture verification</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged or pending only</label></div>
        {shown.length ? <table className="w-full min-w-[860px]">
          <thead><tr>{["", "#", "Store", "Type", "Checks", "Items", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
          <tbody>{shown.map((c) => (
            <tr key={c.id}>
              <td className="td"><a href={c.image_url} target="_blank" rel="noreferrer"><img src={c.image_url} alt="" className="h-10 w-14 rounded object-cover" /></a></td>
              <td className="td font-mono text-xs">{c.id}</td><td className="td">{names.get(c.store_id) ?? c.store_id}<div className="text-xs text-slate-500">{when(c.created_at)}</div></td>
              <td className="td capitalize">{c.kind}</td>
              <td className="td text-xs">
                {c.duplicate_of ? <span className="chip bg-red-100 text-red-700">Duplicate of #{c.duplicate_of}</span> : null}
                {!c.quality_ok ? c.quality_issues.map((q) => <span key={q} className="chip ml-1 bg-amber-100 text-amber-800">{ISSUE_TEXT[q] ?? q}</span>) : null}
                {!c.duplicate_of && c.quality_ok ? <span className="chip bg-emerald-100 text-emerald-700">Passed</span> : null}
                <div className="mt-1 font-mono text-[10px] text-slate-400" title="perceptual hash">{c.phash.slice(0, 16)}… · sharp {c.blur_score.toFixed(0)}</div>
              </td>
              <td className="td">{c.items.length}</td>
              <td className="td"><span className={`chip ${c.status === "verified" ? "bg-emerald-100 text-emerald-700" : c.status === "rejected" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-800"}`}>{c.status.replace("_", " ")}</span>{c.points_awarded ? <div className="text-xs text-emerald-700">+{c.points_awarded} pts</div> : null}</td>
              <td className="td">{c.status === "pending_review" && !c.duplicate_of ? <div className="flex gap-1"><button className="btn btn-sm" onClick={() => approve(c)}>Verify</button><button className="btn-danger btn-sm" onClick={() => reject(c)}>Reject</button></div> : null}</td>
            </tr>))}</tbody></table> : <Empty>Nothing flagged.</Empty>}
      </section>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">Audit log</h2>
        <table className="w-full min-w-[720px]"><thead><tr>{["When", "Store", "Action", "Details"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{log.slice(0, 150).map((a) => (
            <tr key={a.id}><td className="td whitespace-nowrap text-xs">{when(a.created_at)}</td><td className="td">{a.store_id ? names.get(a.store_id) ?? a.store_id : "—"}</td>
              <td className="td font-medium">{ACTION_TEXT[a.action] ?? a.action} <span className="text-xs text-slate-400">{a.entity} #{a.entity_id}</span></td>
              <td className="td font-mono text-xs text-slate-600">{Object.entries(a.detail).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ")}</td></tr>))}</tbody></table>
      </section>
    </div>
  );
}
