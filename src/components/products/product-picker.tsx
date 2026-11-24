"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { formatPeso, formatQty } from "@/lib/money";

export interface PickedProduct {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  purchase_cost_centavos: number;
  selling_price_centavos: number;
}

/** Type-ahead product search against the store's catalog (name, brand, SKU or exact barcode). */
export function ProductPicker({ storeId, onPick, placeholder = "Search product to add…" }: { storeId: string; onPick: (p: PickedProduct) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) return; // list is hidden below 2 chars
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ items: PickedProduct[] }>(`/api/v1/stores/${storeId}/products?limit=8&q=${encodeURIComponent(q.trim())}`);
        if (n === seq.current) {
          setItems(r.items);
          setActive(0);
        }
      } catch {
        if (n === seq.current) setItems([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, storeId]);

  const pick = (p: PickedProduct) => {
    onPick(p);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            pick(items[active]);
          }
        }}
        placeholder={placeholder}
        className="pl-9"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls="product-picker-list"
        aria-label="Search products"
        autoComplete="off"
      />
      {loading && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />}
      {open && q.trim().length >= 2 && !loading && (
        <ul id="product-picker-list" role="listbox" className="bg-popover absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border shadow-lg">
          {items.length === 0 ? (
            <li className="text-muted-foreground p-3 text-sm">No product matches “{q}”.</li>
          ) : (
            items.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm ${i === active ? "bg-accent" : ""}`}>
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground num text-xs">{formatQty(p.quantity)} {p.unit}</span>
                  <span className="num text-xs">{formatPeso(p.selling_price_centavos)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
