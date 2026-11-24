"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/app/confirmation-dialog";
import { MoneyInput } from "@/components/products/money-input";
import { ProductPicker, type PickedProduct } from "@/components/products/product-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api, ApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatPeso, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ReceiptDetail } from "@/server/services/receipts";

type Action = "match" | "create" | "skip";
interface Row {
  key: string;
  id?: string;
  rawDescription: string;
  action: Action;
  product: { id: string; name: string; unit: string; stock: number } | null;
  quantity: string;
  unitCostCentavos: number | null;
  newName: string;
  newUnit: string;
  newPriceCentavos: number | null;
  confidence: number | null;
  matchConfidence: number | null;
  extracted: ReceiptDetail["items"][number]["extracted"] | null;
}

const conf = (v: number | null) => (v == null ? null : v >= 0.8 ? "high" : v >= 0.55 ? "medium" : "low");

export function ReceiptReviewTable({ storeId, receipt, editable }: { storeId: string; receipt: ReceiptDetail; editable: boolean }) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(receipt.supplierName ?? "");
  const [refNo, setRefNo] = useState(receipt.receiptNumber ?? "");
  const [date, setDate] = useState(receipt.purchaseDate ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    receipt.items.map((i) => ({
      key: i.id,
      id: i.id,
      rawDescription: i.rawDescription,
      action: (i.action ?? "create") as Action,
      product: i.productId ? { id: i.productId, name: i.productName ?? "", unit: i.productUnit ?? "pc", stock: i.productStock ?? 0 } : null,
      quantity: i.quantity != null ? String(i.quantity) : "",
      unitCostCentavos: i.unitCostCentavos,
      newName: i.rawDescription,
      newUnit: "pc",
      newPriceCentavos: i.unitCostCentavos != null ? Math.round((i.unitCostCentavos * 1.15) / 25) * 25 : null,
      confidence: i.extracted.confidence,
      matchConfidence: i.matchConfidence,
      extracted: i.extracted,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const key = useRef(newIdempotencyKey());

  const set = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const active = rows.filter((r) => r.action !== "skip");
  const total = active.reduce((s, r) => s + Math.round((Number(r.quantity) || 0) * (r.unitCostCentavos ?? 0)), 0);
  const preview = active
    .filter((r) => r.quantity && (r.action === "create" || r.product))
    .map((r) => ({ name: r.action === "create" ? `${r.newName} (new)` : r.product!.name, before: r.action === "create" ? 0 : r.product!.stock, add: Number(r.quantity) || 0, unit: r.action === "create" ? r.newUnit : r.product!.unit }));

  async function confirm() {
    setErrors({});
    setFormError(null);
    try {
      await api(`/api/v1/stores/${storeId}/receipts/${receipt.id}/confirm`, {
        method: "POST",
        json: {
          idempotencyKey: key.current,
          supplierName: supplier || null,
          receiptNumber: refNo || null,
          purchaseDate: date || null,
          lines: rows.map((r) => ({
            id: r.id,
            rawDescription: r.rawDescription || r.newName || "Item",
            action: r.action,
            productId: r.action === "match" ? r.product?.id ?? null : null,
            quantity: r.action === "skip" ? null : Number(r.quantity) || null,
            unitCostCentavos: r.action === "skip" ? null : r.unitCostCentavos,
            newProduct: r.action === "create" ? { name: r.newName, unit: r.newUnit || "pc", sellingPriceCentavos: r.newPriceCentavos ?? 0 } : null,
          })),
        },
      });
      toast.success("Stock updated from receipt");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        const fe: Record<string, string> = {};
        if (Array.isArray(e.details)) for (const d of e.details as { path: string; message: string }[]) fe[d.path] = d.message;
        setErrors(fe);
        setFormError(e.message);
      }
      throw e;
    }
  }
  const err = (i: number, f: string) => errors[`lines.${i}.${f}`];

  if (!editable) {
    return (
      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {receipt.items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{i.rawDescription}</span>
                {i.action === "skip" ? <Badge variant="outline">Skipped</Badge> : <span className="text-muted-foreground truncate">→ {i.productName ?? "—"}</span>}
                <span className="num w-16 text-right">{i.quantity != null ? formatQty(i.quantity) : ""}</span>
                <span className="num w-20 text-right">{i.unitCostCentavos != null ? formatPeso(i.unitCostCentavos) : ""}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">Supplier<Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Super8" /></label>
          <label className="grid gap-1 text-sm">Receipt no.<Input value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Date<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Check each item</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && <p className="text-muted-foreground text-sm">No items yet. Add the lines from the receipt below.</p>}
          {rows.map((r, i) => (
            <div key={r.key} className={cn("space-y-2 rounded-lg border p-3", r.action === "skip" && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Receipt text" value={r.rawDescription} onChange={(e) => set(r.key, { rawDescription: e.target.value })} disabled={!!r.id} className="h-9 min-w-0 flex-1 font-mono text-xs" placeholder="Item as written on the receipt" />
                {conf(r.confidence) && <Badge variant={conf(r.confidence) === "high" ? "success" : conf(r.confidence) === "medium" ? "warning" : "destructive"}>Reading: {conf(r.confidence)}</Badge>}
                <div className="w-40"><NativeSelect aria-label="Action" value={r.action} onChange={(e) => set(r.key, { action: e.target.value as Action })} className="h-9"><option value="match">Existing product</option><option value="create">New product</option><option value="skip">Skip line</option></NativeSelect></div>
                {!r.id && <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 className="text-destructive" /></Button>}
              </div>
              {r.action === "match" && (
                <div className="space-y-1">
                  {r.product ? (
                    <div className="bg-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                      <CheckCircle2 className="text-primary size-4" />
                      <span className="flex-1 truncate font-medium">{r.product.name}</span>
                      {r.matchConfidence != null && <span className="text-muted-foreground text-xs">{Math.round(r.matchConfidence * 100)}% match</span>}
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => set(r.key, { product: null })}>Change</Button>
                    </div>
                  ) : (
                    <ProductPicker storeId={storeId} placeholder="Which product is this?" onPick={(p: PickedProduct) => set(r.key, { product: { id: p.id, name: p.name, unit: p.unit, stock: Number(p.quantity) } })} />
                  )}
                  {err(i, "productId") && <p className="text-destructive text-xs">{err(i, "productId")}</p>}
                </div>
              )}
              {r.action === "create" && (
                <div className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem]">
                  <Input aria-label="New product name" value={r.newName} onChange={(e) => set(r.key, { newName: e.target.value })} placeholder="Product name" />
                  <Input aria-label="Unit" value={r.newUnit} onChange={(e) => set(r.key, { newUnit: e.target.value })} placeholder="Unit" />
                  <MoneyInput id={`price-${r.key}`} aria-label="Selling price" defaultCentavos={r.newPriceCentavos} onCentavos={(c) => set(r.key, { newPriceCentavos: c })} placeholder="Sell price" />
                  {err(i, "newProduct") && <p className="text-destructive text-xs sm:col-span-3">{err(i, "newProduct")}</p>}
                </div>
              )}
              {r.action !== "skip" && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_9rem_1fr]">
                  <label className="grid gap-1 text-xs">Quantity<Input value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} inputMode="decimal" className="num h-9" aria-invalid={!!err(i, "quantity")} /></label>
                  <label className="grid gap-1 text-xs">Unit cost<MoneyInput id={`cost-${r.key}`} defaultCentavos={r.unitCostCentavos} onCentavos={(c) => set(r.key, { unitCostCentavos: c })} className="h-9" invalid={!!err(i, "unitCostCentavos")} /></label>
                  <p className="text-muted-foreground self-end pb-2 text-right text-xs">
                    Line total <span className="num text-foreground font-medium">{formatPeso(Math.round((Number(r.quantity) || 0) * (r.unitCostCentavos ?? 0)))}</span>
                    {r.extracted?.lineTotalCentavos != null && <> · receipt says {formatPeso(r.extracted.lineTotalCentavos)}</>}
                  </p>
                </div>
              )}
            </div>
          ))}
          <Button variant="outline" onClick={() => setRows([...rows, { key: newIdempotencyKey(), rawDescription: "", action: "match", product: null, quantity: "", unitCostCentavos: null, newName: "", newUnit: "pc", newPriceCentavos: null, confidence: null, matchConfidence: null, extracted: null }])}>
            <Plus /> Add a line manually
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stock after confirming</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {preview.length === 0 ? <p className="text-muted-foreground text-sm">Nothing will change yet.</p> : (
            <ul className="divide-y text-sm">
              {preview.map((p, i) => (
                <li key={i} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">{p.name}</span>
                  <span className="num whitespace-nowrap">{formatQty(p.before)} → <b>{formatQty(p.before + p.add)}</b> {p.unit} <span className="text-success">(+{formatQty(p.add)})</span></span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t pt-2 font-semibold"><span>Total cost</span><span className="num">{formatPeso(total)}</span></div>
          {receipt.grandTotalCentavos != null && receipt.grandTotalCentavos !== total && (
            <p className="text-xs">⚠ Receipt total says {formatPeso(receipt.grandTotalCentavos)} — check quantities and costs.</p>
          )}
          {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
          <div className="flex flex-wrap gap-2 pt-2">
            <ConfirmationDialog
              title="Add these items to stock?"
              description={`${active.length} item(s), total cost ${formatPeso(total)}. This records one stock-in and cannot be confirmed twice.`}
              confirmLabel="Confirm stock-in"
              onConfirm={confirm}
              trigger={<Button size="lg" disabled={active.length === 0}><CheckCircle2 /> Confirm stock-in</Button>}
            />
            <ConfirmationDialog
              destructive
              title="Reject this receipt?"
              description={<div className="space-y-2"><p>Nothing will be added to stock.</p><Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (e.g. blurry, duplicate)" aria-label="Reject reason" /></div>}
              confirmLabel="Reject"
              onConfirm={async () => {
                try {
                  await api(`/api/v1/stores/${storeId}/receipts/${receipt.id}/reject`, { method: "POST", json: { reason: rejectReason } });
                  toast.success("Receipt rejected");
                  router.refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                  throw e;
                }
              }}
              trigger={<Button size="lg" variant="outline"><XCircle /> Reject</Button>}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function RetryButton({ storeId, receiptId }: { storeId: string; receiptId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await api(`/api/v1/stores/${storeId}/receipts/${receiptId}/retry`, { method: "POST" });
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Try reading again
    </Button>
  );
}
