import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { kv } from "../../lib/idb";
import { peso, when } from "../../lib/format";
import type { Order } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

export const STATUS_CHIP: Record<Order["status"], string> = { draft: "bg-slate-200 text-slate-700", submitted: "bg-blue-100 text-blue-800", fulfilled: "bg-emerald-100 text-emerald-700", cancelled: "bg-red-100 text-red-700" };

export default function StoreOrders() {
  const { storeId, distributors, toast, online, refreshProducts, products } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [distributor, setDistributor] = useState("Super8");
  const load = useCallback(async () => {
    if (!storeId) return;
    try { const os = await api.orders({ storeId }); setOrders(os); await kv.set(`orders:${storeId}`, os); }
    catch { setOrders((await kv.get<Order[]>(`orders:${storeId}`)) ?? []); }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  const lowCount = products.filter((p) => p.status !== "ok").length;
  const draft = async () => {
    if (!storeId) return;
    try { await api.draftOrder(storeId, distributor); toast("Draft order created from low-stock items"); await load(); } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="grid gap-4">
      <div><h1 className="text-xl font-bold">Restock orders</h1><p className="text-sm text-slate-500">{lowCount} item(s) are low or out of stock.</p></div>
      <div className="card flex flex-wrap items-end gap-2">
        <label className="flex-1"><span className="label">Wholesale distributor</span>
          <select className="input" value={distributor} onChange={(e) => setDistributor(e.target.value)}>{distributors.map((d) => <option key={d}>{d}</option>)}</select></label>
        <button className="btn-primary" disabled={!online} onClick={draft}>Create draft from low stock</button>
        <p className="w-full text-xs text-slate-500">Quantities follow how fast each item sold in the last 14 days (from your ledger photos and scans), so a delivery covers about 10 days. Items with no sales yet refill to twice their alert level.</p>
        {!online ? <p className="w-full text-xs text-amber-700">Offline — you can view saved orders; creating and sending orders needs a connection.</p> : null}
      </div>
      {orders.length ? orders.map((o) => <OrderCard key={o.id} order={o} editable={online} onChange={async () => { await load(); await refreshProducts(); }} />) : <Empty>No orders yet.</Empty>}
    </div>
  );
}

export function OrderCard({ order, editable, onChange, showStore }: { order: Order; editable: boolean; onChange: () => void; showStore?: boolean }) {
  const { toast, products, distributors } = useApp();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [add, setAdd] = useState("");
  const isDraft = order.status === "draft";
  const dirty = Object.keys(qty).length > 0;
  const save = async (extra?: { product_id: number; qty: number }) => {
    const lines = Object.entries(qty).map(([pid, v]) => ({ product_id: Number(pid), qty: Math.max(0, Math.round(Number(v) || 0)) }));
    try { await api.patchOrder(order.id, { lines: extra ? [...lines, extra] : lines }); setQty({}); toast("Order updated"); onChange(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const status = async (s: "submitted" | "fulfilled" | "cancelled") => {
    try { await api.orderStatus(order.id, s); toast(s === "submitted" ? `Sent to ${order.distributor}` : s === "fulfilled" ? "Received — stock added" : "Cancelled"); onChange(); } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="card grid gap-3" data-testid={`order-${order.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">Order #{order.id}{showStore && order.store ? ` · ${order.store}` : ""}</h2>
        <span className={`chip ${STATUS_CHIP[order.status]}`}>{order.status}</span>
        {isDraft && editable ? (
          <select aria-label="Distributor" className="input w-auto py-1" value={order.distributor} onChange={async (e) => { try { await api.patchOrder(order.id, { distributor: e.target.value }); onChange(); } catch (err) { toast((err as Error).message, "err"); } }}>
            {[...new Set([order.distributor, ...distributors])].map((d) => <option key={d}>{d}</option>)}
          </select>) : <span className="text-sm text-slate-600">→ {order.distributor}</span>}
        <span className="ml-auto text-sm font-semibold tabular-nums">{peso(order.total)}</span>
      </div>
      <div className="text-xs text-slate-500">Created {when(order.created_at)}{order.submitted_at ? ` · sent ${when(order.submitted_at)}` : ""}{order.fulfilled_at ? ` · received ${when(order.fulfilled_at)}` : ""}</div>
      {order.lines.length ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[420px]">
          <thead><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Unit cost</th><th className="th text-right">Total</th></tr></thead>
          <tbody>{order.lines.map((l) => (
            <tr key={l.id}><td className="td"><div className="font-medium">{l.name}</div><div className="font-mono text-xs text-slate-500">{l.sku}</div>{l.reason ? <div className="text-xs text-brand-700">{l.reason}</div> : null}</td>
              <td className="td text-right">{isDraft && editable ? <input aria-label={`Quantity of ${l.name}`} type="number" min={0} className="input w-20 py-1 text-right" value={qty[l.product_id] ?? String(l.qty)} onChange={(e) => setQty({ ...qty, [l.product_id]: e.target.value })} /> : l.qty}</td>
              <td className="td text-right tabular-nums">{peso(l.unit_cost)}</td><td className="td text-right tabular-nums">{peso(l.line_total)}</td></tr>))}</tbody>
        </table></div>) : <Empty>No items. Add one below.</Empty>}
      {isDraft && editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Add product to order" className="input w-auto flex-1 py-1.5" value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">+ Add a product…</option>{products.filter((p) => p.id > 0 && !order.lines.some((l) => l.product_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn btn-sm" disabled={!add} onClick={() => { save({ product_id: Number(add), qty: 12 }); setAdd(""); }}>Add 12</button>
          {dirty ? <button className="btn btn-sm" onClick={() => save()}>Save quantities</button> : null}
          <span className="flex-1" />
          <button className="btn-danger btn-sm" onClick={() => status("cancelled")}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={dirty || !order.lines.length} onClick={() => status("submitted")}>Submit to {order.distributor}</button>
        </div>) : null}
      {order.status === "submitted" && editable ? <div className="flex justify-end gap-2"><button className="btn-danger btn-sm" onClick={() => status("cancelled")}>Cancel</button><button className="btn-primary btn-sm" onClick={() => status("fulfilled")}>Mark received (adds stock)</button></div> : null}
    </div>
  );
}
