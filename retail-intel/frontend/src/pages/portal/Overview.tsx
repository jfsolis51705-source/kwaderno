import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { peso, pct, when } from "../../lib/format";
import type { Overview as OverviewT } from "../../lib/types";
import { Empty, Kpi, StockChip } from "../../components/ui";

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#8b5cf6", "#e0a100", "#0e7c86", "#d9467a", "#64748b"];

export default function Overview() {
  const [ov, setOv] = useState<OverviewT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [alertStore, setAlertStore] = useState<number | "">("");
  useEffect(() => { api.overview().then(setOv).catch((e) => setErr((e as Error).message)); }, []);
  if (err) return <Empty>Could not load the portal: {err}</Empty>;
  if (!ov) return <Empty>Loading…</Empty>;
  const t = ov.totals;
  const sos = ov.share_of_shelf.slice(0, 8);
  const alerts = ov.alerts.filter((a) => !alertStore || a.store_id === alertStore);
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Stores" value={t.stores} /><Kpi label="SKUs tracked" value={t.skus} />
        <Kpi label="Low stock" value={t.low} tone="warn" /><Kpi label="Out of stock" value={t.out} tone="bad" />
        <Kpi label="Captures" value={t.captures} hint={`${ov.captures_by_status.pending_review ?? 0} pending · ${ov.captures_by_status.verified ?? 0} verified`} />
        <Kpi label="Flagged photos" value={t.flagged} hint="duplicate or low quality" tone={t.flagged ? "warn" : undefined} />
        <Kpi label="Open wholesale orders" value={t.open_orders} hint={`${t.points} points issued`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="card" aria-labelledby="sos-h">
          <h2 id="sos-h" className="font-bold">Share of shelf by brand</h2>
          <p className="mb-3 text-xs text-slate-500">Units counted on each store's latest verified shelf photo ({ov.shelf_captures_used} store(s)).</p>
          {sos.length ? (
            <>
              <div className="flex h-5 overflow-hidden rounded-full" role="img" aria-label="Share of shelf stacked bar">{sos.map((b, i) => <div key={b.brand} title={`${b.brand} ${pct(b.share)}`} style={{ width: `${b.share * 100}%`, background: PALETTE[i % PALETTE.length] }} />)}</div>
              <ul className="mt-3 grid gap-1.5">{sos.map((b, i) => (
                <li key={b.brand} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-sm">
                  <span className="flex items-center gap-2 truncate"><i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{b.brand}</span>
                  <span className="h-2 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded" style={{ width: `${(b.share / sos[0].share) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></span>
                  <span className="tabular-nums text-slate-600">{pct(b.share)} · {b.units}</span>
                </li>))}</ul>
            </>) : <Empty>No verified shelf photos yet.</Empty>}
        </section>
        <section className="card" aria-labelledby="health-h">
          <h2 id="health-h" className="font-bold">SKU stock health by store</h2>
          <ul className="mt-3 grid gap-3">{ov.stores.map((s) => {
            const n = Math.max(1, s.skus);
            return (
              <li key={s.id}>
                <div className="flex items-baseline justify-between text-sm"><span className="font-semibold">{s.name}</span><span className="text-xs text-slate-500">{s.skus} SKUs</span></div>
                <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${s.name}: ${s.ok} ok, ${s.low} low, ${s.out} out`}>
                  <span className="bg-emerald-500" style={{ width: `${(s.ok / n) * 100}%` }} /><span className="bg-amber-400" style={{ width: `${(s.low / n) * 100}%` }} /><span className="bg-red-500" style={{ width: `${(s.out / n) * 100}%` }} />
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{s.ok} ok · {s.low} low · {s.out} out</div>
              </li>);
          })}</ul>
        </section>
      </div>
      <section className="card overflow-x-auto" aria-labelledby="stores-h">
        <h2 id="stores-h" className="mb-2 font-bold">Stores</h2>
        <table className="w-full min-w-[760px]">
          <thead><tr>{["Store", "Area", "SKUs", "Low", "Out", "Stock value", "Pending photos", "Points", "Last capture"].map((h, i) => <th key={h} className={`th ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{ov.stores.map((s) => (
            <tr key={s.id}><td className="td font-semibold">{s.name}</td><td className="td text-slate-500">{[s.barangay, s.city].filter(Boolean).join(", ")}</td>
              <td className="td text-right">{s.skus}</td><td className="td text-right text-amber-700">{s.low}</td><td className="td text-right text-red-700">{s.out}</td>
              <td className="td text-right tabular-nums">{peso(s.stock_value)}</td><td className="td text-right">{s.pending_captures}</td><td className="td text-right">{s.points}</td><td className="td text-right text-xs">{when(s.last_capture_at)}</td></tr>))}</tbody>
        </table>
      </section>
      <section className="card overflow-x-auto" aria-labelledby="oos-h">
        <div className="mb-2 flex flex-wrap items-center gap-2"><h2 id="oos-h" className="flex-1 font-bold">Out-of-stock & low-stock alerts ({alerts.length})</h2>
          <select aria-label="Filter alerts by store" className="input w-auto py-1.5" value={alertStore} onChange={(e) => setAlertStore(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All stores</option>{ov.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {alerts.length ? <table className="w-full min-w-[620px]"><thead><tr>{["Store", "Product", "Brand", "On hand", "Alert at", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{alerts.map((a) => <tr key={`${a.store_id}-${a.product_id}`}><td className="td">{a.store}</td><td className="td font-medium">{a.name}</td><td className="td text-slate-500">{a.brand ?? "—"}</td><td className="td tabular-nums">{a.qty_on_hand}</td><td className="td tabular-nums">{a.reorder_level}</td><td className="td"><StockChip status={a.status} /></td></tr>)}</tbody></table>
          : <Empty>No alerts.</Empty>}
      </section>
    </div>
  );
}
