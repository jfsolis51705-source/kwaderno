"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Loader2, PackagePlus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/states";
import { BarcodeScanner, type ScanResult } from "@/components/inventory/barcode-scanner";
import { StockBadge } from "@/components/products/stock-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatPeso, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ProductRow } from "@/server/services/catalog";

type Mode = "lookup" | "count";
type Lookup = { code: string; product: ProductRow | null } | null;

export function ScanWorkspace({ storeId }: { storeId: string }) {
  const [mode, setMode] = useState<Mode>("lookup");
  const [last, setLast] = useState<Lookup>(null);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<{ product: ProductRow; counted: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const countKey = useRef(newIdempotencyKey());

  async function onScan(r: ScanResult) {
    setBusy(true);
    try {
      const res = await api<{ found: boolean; product: ProductRow | null }>(`/api/v1/stores/${storeId}/barcodes/${encodeURIComponent(r.code)}`);
      setLast({ code: r.code, product: res.product });
      if (mode === "count" && res.product) {
        const p = res.product;
        setCounts((cs) => {
          const i = cs.findIndex((c) => c.product.id === p.id);
          if (i >= 0) return cs.map((c, j) => (j === i ? { ...c, counted: String(Number(c.counted || 0) + 1) } : c));
          return [{ product: p, counted: "1" }, ...cs];
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCount() {
    setSaving(true);
    try {
      const r = await api<{ corrections: unknown[]; unchanged: string[] }>(`/api/v1/stores/${storeId}/inventory/counts`, {
        method: "POST",
        json: { idempotencyKey: countKey.current, note: "Scan count", lines: counts.map((c) => ({ productId: c.product.id, countedQuantity: Number(c.counted) })) },
      });
      countKey.current = newIdempotencyKey();
      toast.success(`Count saved: ${r.corrections.length} corrected, ${r.unchanged.length} matched`);
      setCounts([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const MODES = [
    { v: "lookup" as const, label: "Check product", icon: Search },
    { v: "count" as const, label: "Count stock", icon: ClipboardCheck },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist">
          {MODES.map((m) => (
            <Button key={m.v} role="tab" aria-selected={mode === m.v} variant={mode === m.v ? "default" : "outline"} onClick={() => setMode(m.v)}>
              <m.icon /> {m.label}
            </Button>
          ))}
          <Button asChild variant="outline"><Link href="/stock-in"><PackagePlus /> Stock-in</Link></Button>
          <Button asChild variant="outline"><Link href="/sell"><ShoppingCart /> Sell</Link></Button>
        </div>
        <BarcodeScanner onScan={onScan} cooldownMs={mode === "count" ? 1500 : 2500} />
        {mode === "count" && <p className="text-muted-foreground text-xs">Each scan adds 1 to the counted quantity. You can type the exact number too.</p>}
      </div>

      <div className="space-y-3">
        {busy && <p className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Looking up…</p>}
        {last && !last.product && (
          <Alert variant="warning">
            <AlertTitle>Unknown barcode <span className="num">{last.code}</span></AlertTitle>
            <AlertDescription>
              <p>This barcode is not registered in your store. Add it so it can be scanned next time.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm"><Link href={`/products/new?barcode=${encodeURIComponent(last.code)}`}>Register new product</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href="/products">Add to an existing product</Link></Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {mode === "lookup" && last?.product && (
          <Card className={cn("border-primary/40")}>
            <CardContent className="space-y-3">
              <div>
                <p className="text-lg font-semibold">{last.product.name}</p>
                <p className="text-muted-foreground text-sm">{[last.product.brand, last.product.category].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex items-end justify-between">
                <p className="num text-3xl font-bold">{formatPeso(last.product.selling_price_centavos)}</p>
                <StockBadge quantity={last.product.quantity} threshold={last.product.reorder_threshold} unit={last.product.unit} />
              </div>
              <Button asChild variant="outline" className="w-full"><Link href={`/products/${last.product.id}`}>Open product</Link></Button>
            </CardContent>
          </Card>
        )}
        {mode === "lookup" && !last && <EmptyState icon={Search} title="Scan a barcode" description="Point the camera at a barcode, type it, or use a USB scanner to see price and stock." />}
        {mode === "count" && (
          counts.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Start counting" description="Scan each item on the shelf. When done, save to correct the recorded stock." />
          ) : (
            <Card>
              <CardContent className="space-y-3">
                <ul className="divide-y">
                  {counts.map((c, i) => {
                    const diff = Number(c.counted || 0) - Number(c.product.quantity);
                    return (
                      <li key={c.product.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.product.name}</p>
                          <p className="text-muted-foreground text-xs">
                            Recorded {formatQty(c.product.quantity)} · <span className={diff === 0 ? "" : diff > 0 ? "text-success" : "text-destructive"}>{diff === 0 ? "matches" : `${diff > 0 ? "+" : ""}${formatQty(diff)}`}</span>
                          </p>
                        </div>
                        <Input aria-label={`Counted ${c.product.name}`} value={c.counted} inputMode="decimal" className="num h-10 w-20 text-center" onChange={(e) => setCounts(counts.map((x, j) => (j === i ? { ...x, counted: e.target.value } : x)))} />
                        <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setCounts(counts.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
                      </li>
                    );
                  })}
                </ul>
                <Button size="lg" className="w-full" onClick={saveCount} disabled={saving || counts.some((c) => !(Number(c.counted) >= 0) || c.counted === "")}>
                  {saving && <Loader2 className="animate-spin" />} Save count ({counts.length})
                </Button>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
