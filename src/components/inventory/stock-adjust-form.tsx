"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import { submitOrQueue } from "@/lib/submit-or-queue";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatQty } from "@/lib/money";

const TYPES = [
  { v: "damaged", label: "Damaged / sira", dir: -1, staff: true },
  { v: "expired", label: "Expired", dir: -1, staff: true },
  { v: "supplier_return", label: "Returned to supplier", dir: -1, staff: true },
  { v: "customer_return", label: "Customer returned item", dir: 1, staff: true },
  { v: "stock_in", label: "Received stock (no receipt)", dir: 1, staff: true },
  { v: "adjustment", label: "Other correction", dir: 0, staff: false },
  { v: "opening", label: "Opening stock", dir: 1, staff: false },
] as const;

/** Records a single stock movement. Every change needs a reason and is kept in the history. */
export function StockAdjustForm({ storeId, product, canManage, trigger }: {
  storeId: string;
  product: { id: string; name: string; unit: string; quantity: string };
  canManage: boolean;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]["v"]>("damaged");
  const [direction, setDirection] = useState<"increase" | "decrease">("decrease");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useRef(newIdempotencyKey());
  const t = TYPES.find((x) => x.v === type)!;
  const sign = t.dir !== 0 ? t.dir : direction === "increase" ? 1 : -1;
  const n = Number(qty);
  const after = Number(product.quantity) + (n > 0 ? sign * n : 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await submitOrQueue({
        storeId,
        url: `/api/v1/stores/${storeId}/inventory/adjustments`,
        opType: "inventory.adjust",
        payload: { productId: product.id, type, direction: t.dir === 0 ? direction : undefined, quantity: qty, reason: String(fd.get("reason") ?? ""), idempotencyKey: key.current },
        summary: `${t.label}: ${sign > 0 ? "+" : "−"}${qty} ${product.unit} ${product.name}`,
      });
      key.current = newIdempotencyKey();
      if (r.queued) toast.warning("No internet — saved on this phone. Stock updates when you're back online.");
      else toast.success("Stock updated");
      setOpen(false);
      setQty("");
      setErrors({});
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>{product.name} · on record: {formatQty(product.quantity)} {product.unit}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field id="type" label="What happened?">
            <NativeSelect id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {TYPES.filter((x) => x.staff || canManage).map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
            </NativeSelect>
          </Field>
          {t.dir === 0 && (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Direction">
              {(["increase", "decrease"] as const).map((d) => (
                <Button key={d} type="button" variant={direction === d ? "default" : "outline"} onClick={() => setDirection(d)} aria-pressed={direction === d}>
                  {d === "increase" ? "Add to stock" : "Remove from stock"}
                </Button>
              ))}
            </div>
          )}
          <Field id="quantity" label={`Quantity (${product.unit})`} error={errors.quantity}>
            <Input id="quantity" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="num text-lg" autoFocus />
          </Field>
          <Field id="reason" label="Reason" error={errors.reason} hint="Required — e.g. 'Punit ang 2 sachet'">
            <Input id="reason" name="reason" />
          </Field>
          <p className="bg-muted rounded-lg p-3 text-sm">
            New stock: <span className={`num font-semibold ${after < 0 ? "text-destructive" : ""}`}>{formatQty(after)} {product.unit}</span>
          </p>
          <Button type="submit" size="lg" disabled={busy || !(n > 0)}>
            {busy && <Loader2 className="animate-spin" />} Record {sign > 0 ? "+" : "−"}{n > 0 ? formatQty(n) : ""} {product.unit}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
