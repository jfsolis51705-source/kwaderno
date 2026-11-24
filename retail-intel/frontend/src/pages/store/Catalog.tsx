import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { peso } from "../../lib/format";
import type { Product } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty, StockChip } from "../../components/ui";

export default function Catalog() {
  const { products, editProduct, toast, online, refreshProducts } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const list = useMemo(() => products
    .filter((p) => (filter === "all" || p.status === filter || (filter === "low" && p.status === "out")) && (!q || `${p.name} ${p.sku} ${p.brand ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name)), [products, q, filter]);
  const counts = { low: products.filter((p) => p.status === "low").length, out: products.filter((p) => p.status === "out").length };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2"><div className="flex-1"><h1 className="text-xl font-bold">Stock</h1><p className="text-sm text-slate-500">{products.length} products · {counts.low} low · {counts.out} out of stock{online ? "" : " · showing saved copy (offline)"}</p></div></div>
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" aria-label="Search stock" placeholder="Search name, SKU, brand, barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["all", "low", "out"] as const).map((f) => <button key={f} className={filter === f ? "btn-primary btn-sm" : "btn btn-sm"} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "low" ? "Low & out" : "Out only"}</button>)}
      </div>
      {list.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((p) => (
            <button key={p.sku} className="card flex items-center gap-3 text-left hover:border-brand-500" onClick={() => setEditing(p)}>
              {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" className="h-12 w-12 rounded object-cover" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">{(p.brand ?? p.name).slice(0, 4).toUpperCase()}</div>}
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="text-xs text-slate-500">{peso(p.price)} · alert at {p.reorder_level}</div></div>
              <StockChip status={p.status} qty={p.qty_on_hand} />
            </button>
          ))}
        </div>
      ) : <Empty>No products match.</Empty>}
      {editing ? <EditDialog p={editing} onClose={() => setEditing(null)} onSave={async (patch, thumb) => {
        try {
          await editProduct(editing, patch);
          if (thumb) { if (!online || editing.id < 0) toast("Logo/photo can be added when online", "warn"); else { await api.uploadThumbnail(editing.id, thumb); await refreshProducts(); } }
          toast(online ? "Saved" : "Saved — will sync when online"); setEditing(null);
        } catch (e) { toast((e as Error).message, "err"); }
      }} /> : null}
    </div>
  );
}

function EditDialog({ p, onClose, onSave }: { p: Product; onClose: () => void; onSave: (patch: Partial<Product>, thumb: File | null) => void }) {
  const [f, setF] = useState({ name: p.name, brand: p.brand ?? "", variant: p.variant ?? "", barcode: p.barcode ?? "", price: String(p.price), cost: String(p.cost), reorder: String(p.reorder_level) });
  const [thumb, setThumb] = useState<File | null>(null);
  const field = (k: keyof typeof f, label: string, mode?: "decimal" | "numeric") => (
    <label><span className="label">{label}</span><input className="input" inputMode={mode} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Edit ${p.name}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="card grid max-h-[90vh] w-full max-w-lg gap-3 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); onSave({ name: f.name.trim() || p.name, brand: f.brand.trim() || null, variant: f.variant.trim() || null, barcode: f.barcode.trim() || null, price: Math.max(0, Number(f.price) || 0), cost: Math.max(0, Number(f.cost) || 0), reorder_level: Math.max(0, Math.round(Number(f.reorder) || 0)) }, thumb); }}>
        <div className="flex items-center justify-between"><h2 className="font-bold">Edit product</h2><span className="font-mono text-xs text-slate-500">{p.sku}</span></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("name", "Name")}{field("brand", "Brand")}{field("variant", "Variant / size")}{field("barcode", "Barcode", "numeric")}
          {field("price", "Selling price (₱)", "decimal")}{field("cost", "Cost (₱)", "decimal")}{field("reorder", "Low-stock alert at", "numeric")}
          <label><span className="label">Logo / photo</span><input type="file" accept="image/*" className="input py-1.5" onChange={(e) => setThumb(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
      </form>
    </div>
  );
}
