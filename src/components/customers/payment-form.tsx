"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { MoneyInput } from "@/components/products/money-input";
import { PaymentMethodSelector } from "@/components/sales/payment-method-selector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { submitOrQueue } from "@/lib/submit-or-queue";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatPeso } from "@/lib/money";

/** Records a partial or full utang payment. The old entries stay in the ledger. */
export function PaymentFormDialog({ storeId, customerId, name, balanceCentavos, trigger }: { storeId: string; customerId: string; name: string; balanceCentavos: number; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountKey, setAmountKey] = useState(0);
  const [method, setMethod] = useState<"cash" | "gcash">("cash");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const remaining = balanceCentavos - (amount ?? 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submitOrQueue({
        storeId,
        url: `/api/v1/stores/${storeId}/customers/${customerId}/payments`,
        opType: "customer.payment",
        payload: { customerId, amountCentavos: amount, method, referenceNo: method === "gcash" ? ref || null : null, idempotencyKey: key.current },
        summary: `${name} paid ${formatPeso(amount)} (${method === "gcash" ? "GCash" : "cash"})`,
      });
      key.current = newIdempotencyKey();
      if (r.queued) toast.warning("No internet — payment saved on this phone and will sync when you're back online.");
      else toast.success(remaining === 0 ? `${name} is fully paid` : `Payment recorded. Remaining: ${formatPeso(remaining)}`);
      setOpen(false);
      setAmount(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{name} owes {formatPeso(balanceCentavos)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field id="pay-amount" label="Amount paid" error={error ?? undefined}>
            <MoneyInput key={amountKey} id="pay-amount" defaultCentavos={amount} onCentavos={setAmount} className="h-12 text-lg" autoFocus />
          </Field>
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => { setAmount(balanceCentavos); setAmountKey((k) => k + 1); }}>
            Pay full {formatPeso(balanceCentavos)}
          </Button>
          <PaymentMethodSelector methods={["cash", "gcash"]} value={method} onChange={(v) => v !== "credit" && setMethod(v)} />
          {method === "gcash" && (
            <Field id="pay-ref" label="GCash reference (optional)"><Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} inputMode="numeric" /></Field>
          )}
          {amount != null && amount > 0 && (
            <p className={`rounded-lg p-3 text-sm ${remaining < 0 ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
              {remaining < 0 ? "That is more than the balance." : `Remaining after payment: ${formatPeso(remaining)}`}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || !amount || remaining < 0}>
            {busy && <Loader2 className="animate-spin" />} Record {amount ? formatPeso(amount) : ""} payment
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
