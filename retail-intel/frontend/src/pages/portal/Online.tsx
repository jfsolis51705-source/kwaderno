import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { peso, pct, when } from "../../lib/format";
import type { PortalOnline } from "../../lib/types";
import { Empty, Kpi } from "../../components/ui";

const PAGE = 50;
const SORTS = [["sales", "Most sales"], ["orders", "Most orders"], ["open", "Waiting now"], ["last", "Latest order"], ["name", "Name A–Z"]] as const;

/** Online ordering across every store. Paged and aggregated on the server, so it stays quick with 1,000+ stores.
 *  Customer names, phones and addresses stay with each store; this page shows numbers and order status only. */
export default function PortalOnlinePage() {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("sales");
  const [page, setPage] = useState(0);
  const [d, setD] = useState<PortalOnline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = window.setTimeout(() => { setQuery(q.trim()); setPage(0); }, 300); return () => window.clearTimeout(t); }, [q]);
  useEffect(() => { setErr(null); api.portalOnline({ days, q: query, sort, limit: PAGE, offset: page * PAGE }).then(setD).catch((e) => setErr((e as Error).message)); }, [days, query, sort, page]);
  if (err) return <Empty>Could not load online orders: {err}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  // every day in the period, including days without orders, so the bars keep a true time scale
  const byDay = new Map(d.daily.map((x) => [x.day, x]));
  const series = Array.from({ length: d.days }, (_, i) => { const dt = new Date(); dt.setDate(dt.getDate() - (d.days - 1 - i)); const k = dt.toISOString().slice(0, 10); return byDay.get(k) ?? { day: k, orders: 0, sales: 0 }; });
  const t = d.totals, max = Math.max(1, ...series.map((x) => x.orders)), pages = Math.max(1, Math.ceil(d.total_rows / PAGE));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">Online orders · all stores</h1>
        <div className="ml-auto flex gap-1" role="group" aria-label="Period">{[7, 30, 90].map((n) => <button key={n} className={days === n ? "btn-primary btn-sm" : "btn btn-sm"} onClick={() => { setDays(n); setPage(0); }}>{n} days</button>)}</div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="online-kpis">
        <Kpi label="Stores with a link" value={t.shops} hint={`${t.shops_open} open · ${t.stores} stores in all`} />
        <Kpi label="Stores with orders" value={t.active_stores} hint={`last ${d.days} days`} />
        <Kpi label="Orders" value={t.orders.toLocaleString()} hint={`${pct(t.completion_rate)} completed`} />
        <Kpi label="Online sales" value={peso(t.sales)} hint="completed orders" />
        <Kpi label="Average order" value={peso(t.avg_order)} />
        <Kpi label="Delivery share" value={pct(t.delivery_share)} hint="vs pickup" />
        <Kpi label="Waiting now" value={t.open_now} hint="new, accepted or ready" tone={t.open_now ? "warn" : undefined} />
      </div>
      <section className="card" aria-labelledby="od-h">
        <h2 id="od-h" className="mb-3 font-bold">Orders per day</h2>
        {d.daily.length ? (
          <div className="flex h-36 items-end gap-[2px] border-b border-slate-200" role="img" aria-label={`Orders per day for the last ${d.days} days`}>
            {series.map((x) => <div key={x.day} className={`min-w-0 flex-1 rounded-t ${x.orders ? "bg-brand-500" : "bg-transparent"}`} style={{ height: `${(x.orders / max) * 100}%` }} title={`${x.day}: ${x.orders} orders · ${peso(x.sales)}`} />)}
          </div>
        ) : <Empty>No online orders in this period.</Empty>}
        {d.daily.length ? <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{series[0].day}</span><span>tallest bar = {max} order{max === 1 ? "" : "s"}</span><span>{series[series.length - 1].day}</span></div> : null}
      </section>
      <section className="card grid gap-3" aria-labelledby="os-h">
        <div className="flex flex-wrap items-center gap-2"><h2 id="os-h" className="font-bold">Stores</h2><span className="text-sm text-slate-500">{d.total_rows.toLocaleString()} with an order link</span>
          <input className="input ml-auto w-full sm:w-64" placeholder="Search store, barangay, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stores" />
          <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="online-stores">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500">{["Store", "Area", "Link", "Orders", "Done", "Cancelled", "Waiting", "Sales", "Last order"].map((h, i) => <th key={h} className={`px-2 py-2 ${i > 2 && i < 8 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{d.stores.map((r) => (
            <tr key={r.id}><td className="px-2 py-2 font-semibold">{r.name}</td><td className="px-2 py-2 text-slate-600">{[r.barangay, r.city].filter(Boolean).join(", ")}</td>
              <td className="px-2 py-2"><a className="text-brand-700 underline" href={`/shop/${r.slug}`} target="_blank" rel="noreferrer">/{r.slug}</a> {r.enabled ? null : <span className="chip bg-slate-100 text-slate-500">closed</span>}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.orders}</td><td className="px-2 py-2 text-right tabular-nums">{r.completed}</td><td className="px-2 py-2 text-right tabular-nums">{r.cancelled}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.open_now ? <span className="chip bg-amber-100 text-amber-800">{r.open_now}</span> : 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{peso(r.sales)}</td><td className="px-2 py-2 text-slate-500">{r.last_order_at ? when(r.last_order_at) : "—"}</td></tr>))}</tbody>
        </table></div>
        {d.stores.length ? null : <Empty>No stores match.</Empty>}
        <div className="flex items-center justify-end gap-2 text-sm"><button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="tabular-nums" data-testid="online-page">Page {page + 1} of {pages}</span><button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next ›</button></div>
      </section>
      <section className="card" aria-labelledby="or-h"><h2 id="or-h" className="mb-2 font-bold">Latest orders</h2>
        {d.recent.length ? <ul className="divide-y divide-slate-100">{d.recent.map((o) => (
          <li key={o.store + o.code} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="font-mono font-semibold">{o.code}</span><span className="flex-1 truncate">{o.store}</span>
            <span className="text-slate-500">{o.fulfillment}</span><span className="chip bg-slate-100 text-slate-600">{o.status}</span><span className="w-24 text-right tabular-nums">{peso(o.total)}</span><span className="w-28 text-right text-xs text-slate-500">{when(o.created_at)}</span></li>))}</ul> : <Empty>No orders yet.</Empty>}
        <p className="mt-2 text-xs text-slate-500">Customer names, phone numbers and addresses stay with each store and are not shown here.</p></section>
    </div>
  );
}
