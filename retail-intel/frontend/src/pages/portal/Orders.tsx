import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Order, Store } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";
import { OrderCard } from "../store/Orders";

export default function PortalOrders() {
  const { online, stores } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("submitted");
  const names = new Map(stores.map((s: Store) => [s.id, s.name]));
  const load = useCallback(async () => { try { setOrders(await api.orders({ status: status || undefined })); } catch { setOrders([]); } }, [status]);
  useEffect(() => { load(); }, [load]);
  const byDist = orders.reduce<Record<string, number>>((m, o) => ({ ...m, [o.distributor]: (m[o.distributor] ?? 0) + o.total }), {});
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><h1 className="text-xl font-bold">Wholesale order queue</h1><p className="text-sm text-slate-500">Restock orders from all stores, routed to distributors.</p></div>
        <select aria-label="Order status" className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          {[["submitted", "Submitted (to fulfil)"], ["draft", "Drafts"], ["fulfilled", "Fulfilled"], ["cancelled", "Cancelled"], ["", "All"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {Object.keys(byDist).length ? <div className="flex flex-wrap gap-2">{Object.entries(byDist).map(([d, t]) => <span key={d} className="chip bg-white text-slate-700 ring-1 ring-slate-200">{d}: ₱{t.toLocaleString("en-PH", { maximumFractionDigits: 0 })}</span>)}</div> : null}
      {orders.length ? <div className="grid gap-3 lg:grid-cols-2">{orders.map((o) => <OrderCard key={o.id} order={{ ...o, store: names.get(o.store_id) }} showStore editable={online} onChange={load} />)}</div> : <Empty>No orders with this status.</Empty>}
    </div>
  );
}
