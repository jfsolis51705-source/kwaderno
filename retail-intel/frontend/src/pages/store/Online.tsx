import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../lib/api";
import { peso, when } from "../../lib/format";
import type { CustomerOrder, ShopSettings } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

const NEXT: Record<string, { to: "accepted" | "ready" | "completed"; label: string } | undefined> = {
  new: { to: "accepted", label: "Tanggapin / Accept" }, accepted: { to: "ready", label: "Handa na / Ready" }, ready: { to: "completed", label: "Tapos / Complete" },
};
const TONE: Record<string, string> = { new: "bg-amber-100 text-amber-800", accepted: "bg-sky-100 text-sky-800", ready: "bg-emerald-100 text-emerald-800", completed: "bg-slate-100 text-slate-600", cancelled: "bg-red-100 text-red-700" };

/** Store side of online ordering: the shop link + settings, and incoming orders. Stock leaves only on "Complete". */
export default function Online() {
  const { storeId, role, toast, refreshProducts } = useApp();
  const [cfg, setCfg] = useState<ShopSettings | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [filter, setFilter] = useState<"open" | "">("open");
  const [busy, setBusy] = useState(false);
  const owner = role !== "staff";

  const load = useCallback(() => { if (storeId) api.customerOrders(storeId, filter || undefined).then(setOrders).catch(() => setOrders((o) => o ?? [])); }, [storeId, filter]);
  useEffect(() => { if (storeId) api.shopSettings(storeId).then(setCfg).catch(() => undefined); }, [storeId]);
  useEffect(() => { load(); const t = window.setInterval(load, 20000); return () => window.clearInterval(t); }, [load]);

  const link = cfg?.slug ? `${window.location.origin}/shop/${cfg.slug}` : "";
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !cfg) return;
    setBusy(true);
    try { const r = await api.saveShop(storeId, { slug: cfg.slug, enabled: cfg.enabled, pickup: cfg.pickup, delivery: cfg.delivery, delivery_fee: Number(cfg.delivery_fee) || 0, min_order: Number(cfg.min_order) || 0, note: cfg.note }); setCfg(r); toast(r.enabled ? "Bukas na ang online store / Online store is open" : "Saved"); }
    catch (e2) { toast(e2 instanceof ApiError ? e2.message : "Couldn't save", "err"); } finally { setBusy(false); }
  }
  async function act(o: CustomerOrder, to: "accepted" | "ready" | "completed" | "cancelled") {
    if (to === "cancelled" && !window.confirm(`Cancel order ${o.code}?`)) return;
    try { await api.customerOrderStatus(o.id, to); toast(to === "completed" ? `${o.code} completed — stock updated` : `${o.code}: ${to}`); load(); if (to === "completed") await refreshProducts(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Offline — try again", "err"); }
  }
  const copy = () => { navigator.clipboard?.writeText(link).then(() => toast("Link copied"), () => toast(link)); };
  const openCount = (orders ?? []).filter((o) => o.status === "new").length;

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-bold">Online orders {openCount ? <span className="chip bg-amber-100 align-middle text-amber-800" data-testid="new-count">{openCount} bago / new</span> : null}</h1>
      {cfg ? (
        <form className="card grid gap-3" onSubmit={save}>
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Store link</h2>
            <span className={`chip ${cfg.enabled && cfg.path ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{cfg.enabled && cfg.path ? "Open" : "Closed"}</span></div>
          {cfg.path && cfg.enabled ? <div className="flex flex-wrap items-center gap-2"><a className="min-w-0 flex-1 truncate font-mono text-sm text-brand-700 underline" href={link} target="_blank" rel="noreferrer" data-testid="shop-link">{link}</a><button type="button" className="btn btn-sm" onClick={copy}>Copy</button></div> : null}
          {owner ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Link name<input className="input font-mono" value={cfg.slug} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" title="lowercase letters, numbers and dashes" onChange={(e) => setCfg({ ...cfg, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Tumatanggap ng order / Taking orders</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.pickup} onChange={(e) => setCfg({ ...cfg, pickup: e.target.checked })} /> 🛍️ Pickup</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.delivery} onChange={(e) => setCfg({ ...cfg, delivery: e.target.checked })} /> 🛵 Delivery</label>
              {cfg.delivery ? <label className="grid gap-1 text-sm">Delivery fee (₱)<input className="input" type="number" min={0} step="0.01" value={cfg.delivery_fee} onChange={(e) => setCfg({ ...cfg, delivery_fee: Number(e.target.value) })} /></label> : null}
              <label className="grid gap-1 text-sm">Minimum order (₱)<input className="input" type="number" min={0} step="0.01" value={cfg.min_order} onChange={(e) => setCfg({ ...cfg, min_order: Number(e.target.value) })} /></label>
              <label className="grid gap-1 text-sm sm:col-span-2">Note to customers<input className="input" maxLength={300} placeholder="Hal. Bukas 6am–10pm. Delivery sa loob ng barangay lang." value={cfg.note ?? ""} onChange={(e) => setCfg({ ...cfg, note: e.target.value })} /></label>
              <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
            </div>
          ) : <p className="text-sm text-slate-500">Only the owner can change these settings.</p>}
          <p className="text-xs text-slate-500">Customers see only items in stock with a price — never your costs or exact stock. Prices are always taken from your Stock list. Stock goes down when you mark an order Complete.</p>
        </form>
      ) : null}
      <div className="flex items-center gap-2"><h2 className="font-semibold">Orders</h2>
        <div className="ml-auto flex gap-1">{([["open", "Bukas / Open"], ["", "Lahat / All"]] as const).map(([v, l]) => <button key={v} className={filter === v ? "btn-primary btn-sm" : "btn btn-sm"} onClick={() => setFilter(v)}>{l}</button>)}<button className="btn btn-sm" onClick={load} aria-label="Refresh">↻</button></div></div>
      {orders === null ? <Empty>Loading…</Empty> : orders.length ? (
        <div className="grid gap-3 md:grid-cols-2">{orders.map((o) => (
          <div key={o.id} className="card grid gap-2" data-testid="customer-order">
            <div className="flex items-center gap-2"><span className="font-mono text-lg font-bold tracking-wider">{o.code}</span><span className={`chip ${TONE[o.status]}`}>{o.status}</span><span className="ml-auto text-xs text-slate-500">{when(o.created_at)}</span></div>
            <div className="text-sm"><b>{o.customer_name}</b> · <a className="text-brand-700 underline" href={`tel:${o.phone}`}>{o.phone}</a> · {o.fulfillment === "pickup" ? "🛍️ Pickup" : "🛵 Delivery"}</div>
            {o.address ? <div className="text-sm text-slate-600">📍 {o.address}</div> : null}
            {o.note ? <div className="text-sm text-slate-600">📝 {o.note}</div> : null}
            <ul className="text-sm">{o.lines.map((l, i) => <li key={i} className="flex justify-between"><span>{l.qty} × {l.name}</span><span className="tabular-nums">{peso(l.qty * l.price)}</span></li>)}</ul>
            <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold"><span>Total{o.delivery_fee ? ` (incl. ${peso(o.delivery_fee)} delivery)` : ""}</span><span className="tabular-nums">{peso(o.total)}</span></div>
            {NEXT[o.status] ? <div className="flex gap-2"><button className="btn-primary flex-1" onClick={() => act(o, NEXT[o.status]!.to)}>{NEXT[o.status]!.label}</button><button className="btn-danger" onClick={() => act(o, "cancelled")}>Cancel</button></div> : null}
          </div>))}</div>
      ) : <Empty>{filter === "open" ? "Walang bagong order. I-share ang link sa Facebook o GC. / No open orders — share your link." : "No orders yet."}</Empty>}
    </div>
  );
}
