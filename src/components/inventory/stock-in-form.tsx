"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/states";
import { Field } from "@/components/forms/field";
import { BarcodeScanner, type ScanResult } from "@/components/inventory/barcode-scanner";
import { MoneyInput } from "@/components/products/money-input";
import { ProductPicker, type PickedProduct } from "@/components/products/product-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatPeso, formatQty } from "@/lib/money";

interface Line { product: PickedProduct; quantity: string; unitCostCentavos: number | null }

/**
 * Workflow B (stock-in): add items by search or barcode, enter quantity and unit cost,
 * then confirm once. The whole delivery is saved as one purchase.
 */
export function StockInForm({ storeId, suppliers }: { storeId: string; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  const add = (p: PickedProduct) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: String(Number(l.quantity || 0) + 1) } : l));
      return [{ product: p, quantity: "1", unitCostCentavos: p.purchase_cost_centavos || null }, ...ls];
    });
  };
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function onScan(r: ScanResult) {
    try {
      const res = await api<{ found: boolean; product: PickedProduct | null }>(`/api/v1/stores/${storeId}/barcodes/${encodeURIComponent(r.code)}`);
      if (res.found && res.product) {
        add(res.product);
        setUnknown(null);
        toast.success(`+1 ${res.product.name}`);
      } else setUnknown(r.code);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const invalid = lines.some((l) => !(Number(l.quantity) > 0) || l.unitCostCentavos == null);
  const total = lines.reduce((s, l) => s + Math.round(Number(l.quantity || 0) * (l.unitCostCentavos ?? 0)), 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lines.length || invalid) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/stores/${storeId}/inventory/stock-in`, {
        method: "POST",
        json: {
          supplierName: String(fd.get("supplierName") || "") || null,
          referenceNo: String(fd.get("referenceNo") || "") || null,
          purchaseDate: String(fd.get("purchaseDate") || "") || undefined,
          idempotencyKey: key.current,
          lines: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity), unitCostCentavos: l.unitCostCentavos })),
        },
      });
      key.current = newIdempotencyKey();
      toast.success(`Stock-in saved: ${lines.length} item(s)`);
      setLines([]);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-3" noValidate>
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader><CardTitle>Items received</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1"><ProductPicker storeId={storeId} onPick={add} /></div>
              <Button type="button" variant={scanning ? "default" : "outline"} className="h-11" onClick={() => setScanning((s) => !s)}>
                <ScanLine /> <span className="hidden sm:inline">{scanning ? "Hide scanner" : "Scan"}</span>
              </Button>
            </div>
            {scanning && <BarcodeScanner onScan={onScan} />}
            {unknown && (
              <Alert variant="warning">
                <AlertDescription>
                  <p>Barcode <span className="num font-medium">{unknown}</span> is not in your products yet.</p>
                  <Button asChild size="sm" className="mt-1"><Link href={`/products/new?barcode=${encodeURIComponent(unknown)}`}>Register new product</Link></Button>
                </AlertDescription>
              </Alert>
            )}
            {lines.length === 0 ? (
              <EmptyState icon={ScanLine} title="No items yet" description="Search or scan the products in this delivery." />
            ) : (
              <ul className="divide-y rounded-lg border">
                {lines.map((l, i) => (
                  <li key={l.product.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.product.name}</p>
                      <p className="text-muted-foreground text-xs">On hand: {formatQty(l.product.quantity)} {l.product.unit}</p>
                    </div>
                    <div>
                      <label className="text-muted-foreground text-xs" htmlFor={`q-${i}`}>Qty ({l.product.unit})</label>
                      <div className="flex">
                        <Button type="button" variant="outline" size="icon" className="rounded-r-none" aria-label="Decrease" onClick={() => update(i, { quantity: String(Math.max(0, Number(l.quantity || 0) - 1)) })}><Minus /></Button>
                        <Input id={`q-${i}`} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} inputMode="decimal" className="num h-10 rounded-none text-center" aria-invalid={!(Number(l.quantity) > 0)} />
                        <Button type="button" variant="outline" size="icon" className="rounded-l-none" aria-label="Increase" onClick={() => update(i, { quantity: String(Number(l.quantity || 0) + 1) })}><Plus /></Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-muted-foreground text-xs" htmlFor={`c-${i}`}>Unit cost</label>
                      <MoneyInput id={`c-${i}`} defaultCentavos={l.unitCostCentavos} onCentavos={(c) => update(i, { unitCostCentavos: c })} invalid={l.unitCostCentavos == null} className="h-10" />
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.product.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Delivery details</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field id="supplierName" label="Supplier (optional)">
              <Input id="supplierName" name="supplierName" list="supplier-list" placeholder="e.g. Super8, Suy Sing" autoComplete="off" />
              <datalist id="supplier-list">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </Field>
            <Field id="referenceNo" label="Receipt / invoice no. (optional)">
              <Input id="referenceNo" name="referenceNo" />
            </Field>
            <Field id="purchaseDate" label="Date received">
              <Input id="purchaseDate" name="purchaseDate" type="date" />
            </Field>
          </CardContent>
        </Card>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="bg-card sticky bottom-20 space-y-2 rounded-xl border p-4 lg:bottom-4">
          <div className="flex justify-between text-sm"><span>Items</span><span className="num">{lines.length}</span></div>
          <div className="flex justify-between text-lg font-semibold"><span>Total cost</span><span className="num">{formatPeso(total)}</span></div>
          <Button type="submit" size="xl" className="w-full" disabled={busy || !lines.length || invalid}>
            {busy && <Loader2 className="animate-spin" />} Confirm stock-in
          </Button>
          {invalid && lines.length > 0 && <p className="text-destructive text-xs">Every item needs a quantity above 0 and a cost.</p>}
        </div>
      </div>
    </form>
  );
}
