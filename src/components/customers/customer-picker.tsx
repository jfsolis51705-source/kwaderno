"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { formatPeso } from "@/lib/money";

export interface PickedCustomer {
  id: string;
  name: string;
  balance_centavos: number;
  credit_limit_centavos: number | null;
}

/** Search existing customers or add a new one by name, without leaving the checkout. */
export function CustomerPicker({ storeId, value, onChange }: { storeId: string; value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ items: PickedCustomer[] }>(`/api/v1/stores/${storeId}/customers?limit=6${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
        if (n === seq.current) setItems(r.items);
      } catch {
        /* list stays as is */
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, storeId]);

  async function addNew() {
    const name = q.trim();
    if (!name) return;
    setAdding(true);
    try {
      const c = await api<{ id: string; name: string; balanceCentavos: number; creditLimitCentavos: number | null }>(`/api/v1/stores/${storeId}/customers`, { method: "POST", json: { name } });
      onChange({ id: c.id, name: c.name, balance_centavos: c.balanceCentavos, credit_limit_centavos: c.creditLimitCentavos });
      setQ("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  if (value) {
    return (
      <div className="bg-accent flex items-center gap-3 rounded-lg p-3">
        <UserRound className="text-primary size-5" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{value.name}</p>
          <p className="text-muted-foreground text-xs">
            Current utang {formatPeso(value.balance_centavos)}
            {value.credit_limit_centavos != null && ` · limit ${formatPeso(value.credit_limit_centavos)}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Change customer" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name" aria-label="Find customer" autoComplete="off" />
        {loading && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />}
      </div>
      <ul className="max-h-48 divide-y overflow-auto rounded-lg border">
        {items.map((c) => (
          <li key={c.id}>
            <button type="button" className="hover:bg-accent flex w-full items-center justify-between px-3 py-2.5 text-left text-sm" onClick={() => onChange(c)}>
              <span className="truncate font-medium">{c.name}</span>
              <span className={`num text-xs ${c.balance_centavos > 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatPeso(c.balance_centavos)}</span>
            </button>
          </li>
        ))}
        {!loading && items.length === 0 && <li className="text-muted-foreground p-3 text-sm">{q ? "No customer with that name." : "No customers yet."}</li>}
      </ul>
      {q.trim() && !items.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && (
        <Button type="button" variant="outline" className="w-full" onClick={addNew} disabled={adding}>
          {adding ? <Loader2 className="animate-spin" /> : <UserPlus />} Add “{q.trim()}” as new customer
        </Button>
      )}
    </div>
  );
}
