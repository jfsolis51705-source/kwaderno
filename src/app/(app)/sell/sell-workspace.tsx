"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CloudOff, History, Loader2, Printer, ScanLine, Search, Share2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { CustomerPicker, type PickedCustomer } from "@/components/customers/customer-picker";
import { BarcodeScanner, type ScanResult } from "@/components/inventory/barcode-scanner";
import { MoneyInput } from "@/components/products/money-input";
import { PaymentMethodSelector, type PaymentMethod } from "@/components/sales/payment-method-selector";
import { ReceiptView, receiptText } from "@/components/sales/receipt-view";
import { SalesCart, type CartLine } from "@/components/sales/sales-cart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError } from "@/lib/api-client";
import { enqueue } from "@/lib/offline-queue";
import { syncNow } from "@/lib/sync-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatPeso, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SaleDetail } from "@/server/services/sales";

export interface SellProduct {
  id: string;
  name: string;
  unit: string;
  priceCentavos: number;
  stock: number;
  category: string | null;
  barcodes: string[];
}

export function SellWorkspace({ storeId, products, canDiscount }: { storeId: string; products: SellProduct[]; canDiscount: boolean }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [filter, setFilter] = useState("");
  const [scanning, setScanning] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState<number | null>(null);
  const [tenderKey, setTenderKey] = useState(0);
  const [gcashRef, setGcashRef] = useState("");
  const [discount, setDiscount] = useState<number | null>(0);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(SaleDetail & { changeCentavos: number | null }) | null>(null);
  const [offlineDone, setOfflineDone] = useState<{ lines: CartLine[]; total: number; change: number | null; method: PaymentMethod } | null>(null);
  const [mobileCart, setMobileCart] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const [stockOverride, setStockOverride] = useState<Record<string, number>>({});

  const stockOf = (p: SellProduct) => stockOverride[p.id] ?? p.stock;
  const add = (p: SellProduct) => {
    setError(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...c, { productId: p.id, name: p.name, unit: p.unit, priceCentavos: p.priceCentavos, stock: stockOf(p), quantity: "1" }];
    });
  };

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? products.filter((p) => p.name.toLowerCase().includes(f) || (p.category ?? "").toLowerCase().includes(f)) : products;
    return list.slice(0, 60);
  }, [filter, products]);

  const subtotal = cart.reduce((s, l) => s + Math.round((Number(l.quantity) || 0) * l.priceCentavos), 0);
  const total = Math.max(0, subtotal - (discount ?? 0));
  const change = method === "cash" && tendered != null ? tendered - total : null;
  const invalidQty = cart.some((l) => !(Number(l.quantity) > 0));
  const canCharge = cart.length > 0 && !invalidQty && !busy && (method !== "credit" || !!customer) && (method !== "cash" || tendered == null || tendered >= total) && discount != null && (discount ?? 0) <= subtotal;

  async function onScan(r: ScanResult) {
    const local = products.find((p) => p.barcodes.includes(r.code));
    if (local) {
      add(local);
      setUnknown(null);
      toast.success(`+1 ${local.name}`, { duration: 1200 });
      return;
    }
    if (!navigator.onLine) {
      setUnknown(r.code);
      return;
    }
    try {
      const res = await api<{ found: boolean; product: { id: string } | null }>(`/api/v1/stores/${storeId}/barcodes/${encodeURIComponent(r.code)}`);
      const p = res.product && products.find((x) => x.id === res.product!.id);
      if (p) {
        add(p);
        setUnknown(null);
        toast.success(`+1 ${p.name}`, { duration: 1200 });
      } else if (res.found) toast.error("That product is archived or inactive.");
      else setUnknown(r.code);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Offline: keep the sale on this device; it syncs with the same ID so it can never be recorded twice. */
  async function saveOffline(payload: Record<string, unknown>) {
    await enqueue({
      operationId: key.current,
      storeId,
      opType: "sale.create",
      payload: { ...payload, occurredAt: new Date().toISOString() },
      summary: `${cart.length} item(s) · ${formatPeso(total)} · ${method === "credit" ? `utang ${customer?.name ?? ""}` : method}`,
    });
    key.current = newIdempotencyKey();
    setStockOverride((st) => {
      const next = { ...st };
      for (const l of cart) {
        const p = products.find((x) => x.id === l.productId);
        if (p) next[p.id] = stockOf(p) - Number(l.quantity);
      }
      return next;
    });
    setOfflineDone({ lines: cart, total, change, method });
    setMobileCart(false);
  }

  async function charge() {
    setBusy(true);
    setError(null);
    const payload = {
      idempotencyKey: key.current,
      paymentMethod: method,
      amountTenderedCentavos: method === "cash" ? tendered : null,
      referenceNo: method === "gcash" ? gcashRef || null : null,
      customerId: method === "credit" ? customer?.id : null,
      discountCentavos: discount ?? 0,
      lines: cart.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
    };
    try {
      if (!navigator.onLine) {
        await saveOffline(payload);
        return;
      }
      const sale = await api<SaleDetail & { changeCentavos: number | null }>(`/api/v1/stores/${storeId}/sales`, { method: "POST", json: payload });
      key.current = newIdempotencyKey();
      setStockOverride((s) => {
        const next = { ...s };
        for (const i of sale.items) {
          const p = products.find((x) => x.id === i.productId);
          if (p) next[p.id] = stockOf(p) - Number(i.quantity);
        }
        return next;
      });
      setDone(sale);
      setMobileCart(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) await saveOffline(payload); // connection dropped mid-request
      else setError(e instanceof ApiError ? e.message : "Could not save the sale");
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    setDone(null);
    setOfflineDone(null);
    void syncNow(storeId).catch(() => {});
    setCart([]);
    setTendered(null);
    setTenderKey((k) => k + 1);
    setGcashRef("");
    setDiscount(0);
    setCustomer(null);
    setMethod("cash");
  }

  const checkout = (
    <div className="space-y-4">
      <SalesCart lines={cart} onChange={setCart} />
      {cart.length > 0 && (
        <>
          {canDiscount && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="discount" className="text-sm">Discount</label>
              <div className="w-32"><MoneyInput id="discount" defaultCentavos={0} onCentavos={setDiscount} className="h-9" /></div>
            </div>
          )}
          <div className="flex items-end justify-between border-t pt-3">
            <span className="text-muted-foreground text-sm">Total</span>
            <span className="num text-3xl font-bold tracking-tight">{formatPeso(total)}</span>
          </div>
          <PaymentMethodSelector value={method} onChange={setMethod} />
          {method === "cash" && (
            <div className="space-y-2">
              <label htmlFor="tendered" className="text-sm">Cash received (optional)</label>
              <MoneyInput key={tenderKey} id="tendered" defaultCentavos={tendered} onCentavos={setTendered} placeholder={(total / 100).toFixed(2)} className="h-12 text-lg" />
              <div className="flex flex-wrap gap-2">
                {[2000, 5000, 10000, 20000, 50000, 100000].filter((v) => v >= total).slice(0, 4).map((v) => (
                  <Button key={v} type="button" size="sm" variant="outline" onClick={() => { setTendered(v); setTenderKey((k) => k + 1); }}>{formatPeso(v)}</Button>
                ))}
              </div>
              {change != null && (
                <p className={cn("rounded-lg p-3 text-lg font-semibold", change < 0 ? "bg-destructive/10 text-destructive" : "bg-success/10")}>
                  {change < 0 ? `Kulang ${formatPeso(-change)}` : `Sukli: ${formatPeso(change)}`}
                </p>
              )}
            </div>
          )}
          {method === "gcash" && (
            <div className="space-y-2">
              <label htmlFor="gcashRef" className="text-sm">GCash reference no. (optional)</label>
              <Input id="gcashRef" value={gcashRef} onChange={(e) => setGcashRef(e.target.value)} inputMode="numeric" />
              <p className="text-muted-foreground text-xs">KWADERNO records this payment only. Check the GCash app to confirm you received it.</p>
            </div>
          )}
          {method === "credit" && <CustomerPicker storeId={storeId} value={customer} onChange={setCustomer} />}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button size="xl" className="w-full" disabled={!canCharge} onClick={charge}>
            {busy && <Loader2 className="animate-spin" />}
            {method === "credit" ? `Record utang ${formatPeso(total)}` : `Charge ${formatPeso(total)}`}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search products" aria-label="Search products" className="pl-9" />
          </div>
          <Button variant={scanning ? "default" : "outline"} className="h-11" onClick={() => setScanning((s) => !s)}>
            <ScanLine /> <span className="hidden sm:inline">{scanning ? "Hide scanner" : "Scan"}</span>
          </Button>
          <Button asChild variant="outline" className="h-11" aria-label="Sales history"><Link href="/sales"><History /></Link></Button>
        </div>
        {scanning && <BarcodeScanner onScan={onScan} cooldownMs={1200} />}
        {unknown && (
          <Alert variant="warning">
            <AlertDescription>
              Barcode <span className="num font-medium">{unknown}</span> is not registered.{" "}
              <Link className="font-medium underline" href={`/products/new?barcode=${encodeURIComponent(unknown)}`}>Register it</Link>
            </AlertDescription>
          </Alert>
        )}
        {products.length === 0 ? (
          <Alert><AlertDescription>No products yet. <Link className="underline" href="/products/new">Add your first product</Link> to start selling.</AlertDescription></Alert>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" aria-label="Products">
            {shown.map((p) => {
              const s = stockOf(p);
              const inCart = cart.find((l) => l.productId === p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className={cn("bg-card flex h-full min-h-20 w-full flex-col justify-between gap-1 rounded-xl border p-3 text-left transition-colors active:scale-[0.98]", inCart ? "border-primary bg-primary/5" : "hover:border-primary/40", s <= 0 && "opacity-60")}
                  >
                    <span className="line-clamp-2 text-sm leading-tight font-medium">{p.name}</span>
                    <span className="flex items-end justify-between gap-1">
                      <span className="num font-semibold">{formatPeso(p.priceCentavos)}</span>
                      <span className={cn("num text-xs", s <= 0 ? "text-destructive" : "text-muted-foreground")}>{inCart ? `×${formatQty(inCart.quantity)}` : `${formatQty(s)} left`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Card className="hidden h-fit lg:sticky lg:top-20 lg:flex">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="size-4" /> Current sale</CardTitle></CardHeader>
        <CardContent>{checkout}</CardContent>
      </Card>

      {cart.length > 0 && (
        <button type="button" onClick={() => setMobileCart(true)} className="bg-primary text-primary-foreground fixed inset-x-4 bottom-20 z-30 flex h-14 items-center justify-between rounded-xl px-4 shadow-lg lg:hidden">
          <span className="flex items-center gap-2 font-medium"><ShoppingCart className="size-5" /> {cart.length} item{cart.length > 1 ? "s" : ""}</span>
          <span className="num text-lg font-bold">{formatPeso(total)} ›</span>
        </button>
      )}
      <Sheet open={mobileCart} onOpenChange={setMobileCart}>
        <SheetContent side="bottom" className="overflow-y-auto px-4 pb-8 lg:hidden">
          <SheetHeader className="px-0"><SheetTitle>Current sale</SheetTitle></SheetHeader>
          {checkout}
        </SheetContent>
      </Sheet>

      <Dialog open={!!offlineDone} onOpenChange={(o) => !o && newSale()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CloudOff className="size-5" /> Saved on this phone</DialogTitle>
            <DialogDescription>No internet right now. This sale will be sent automatically when you are back online. Stock will update then.</DialogDescription>
          </DialogHeader>
          {offlineDone && (
            <div className="space-y-1 font-mono text-sm">
              {offlineDone.lines.map((l) => (
                <div key={l.productId} className="flex justify-between gap-2"><span className="truncate">{l.quantity} × {l.name}</span><span className="num">{formatPeso(Math.round(Number(l.quantity) * l.priceCentavos))}</span></div>
              ))}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>TOTAL</span><span className="num">{formatPeso(offlineDone.total)}</span></div>
              {offlineDone.change != null && offlineDone.change > 0 && <div className="flex justify-between font-semibold"><span>Sukli</span><span className="num">{formatPeso(offlineDone.change)}</span></div>}
            </div>
          )}
          <Button size="lg" onClick={newSale}>New sale</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!done} onOpenChange={(o) => !o && newSale()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{done?.paymentMethod === "credit" ? "Utang recorded" : "Sale complete"}</DialogTitle>
            <DialogDescription>{done && done.changeCentavos != null && done.changeCentavos > 0 ? `Give change: ${formatPeso(done.changeCentavos)}` : "Saved."}</DialogDescription>
          </DialogHeader>
          {done && <ReceiptView sale={done} changeCentavos={done.changeCentavos} />}
          <div className="grid grid-cols-2 gap-2">
            {done && typeof navigator !== "undefined" && "share" in navigator && (
              <Button variant="outline" onClick={() => navigator.share({ text: receiptText(done) }).catch(() => {})}><Share2 /> Share</Button>
            )}
            {done && <Button asChild variant="outline"><Link href={`/sales/${done.id}?print=1`}><Printer /> Print</Link></Button>}
            <Button className="col-span-2" size="lg" onClick={newSale}>New sale</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
