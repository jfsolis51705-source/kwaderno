"use client";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPeso, formatQty } from "@/lib/money";

export interface CartLine {
  productId: string;
  name: string;
  unit: string;
  priceCentavos: number;
  stock: number;
  quantity: string;
}

export function SalesCart({ lines, onChange }: { lines: CartLine[]; onChange: (lines: CartLine[]) => void }) {
  const set = (i: number, q: string) => onChange(lines.map((l, j) => (j === i ? { ...l, quantity: q } : l)));
  if (!lines.length) return <EmptyState icon={ShoppingCart} title="Cart is empty" description="Tap a product, search, or scan a barcode." />;
  return (
    <ul className="divide-y">
      {lines.map((l, i) => {
        const q = Number(l.quantity);
        const over = q > l.stock;
        return (
          <li key={l.productId} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.name}</p>
              <p className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>
                {formatPeso(l.priceCentavos)} · {over ? `only ${formatQty(l.stock)} in stock` : `${formatQty(l.stock)} ${l.unit} left`}
              </p>
            </div>
            <div className="flex items-center">
              <Button type="button" variant="outline" size="icon" className="size-9 rounded-r-none" aria-label={`Less ${l.name}`} onClick={() => (q <= 1 ? onChange(lines.filter((_, j) => j !== i)) : set(i, String(q - 1)))}>
                <Minus />
              </Button>
              <Input aria-label={`Quantity of ${l.name}`} value={l.quantity} onChange={(e) => set(i, e.target.value)} inputMode="decimal" className="num h-9 w-14 rounded-none px-1 text-center" />
              <Button type="button" variant="outline" size="icon" className="size-9 rounded-l-none" aria-label={`More ${l.name}`} onClick={() => set(i, String((q || 0) + 1))}>
                <Plus />
              </Button>
            </div>
            <span className="num w-20 text-right text-sm font-semibold">{formatPeso(Math.round((q || 0) * l.priceCentavos))}</span>
            <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`Remove ${l.name}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              <Trash2 className="text-destructive" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
