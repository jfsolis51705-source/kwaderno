"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { MoneyInput } from "@/components/products/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";

export interface CustomerValues { id?: string; name: string; phone: string | null; address: string | null; notes: string | null; creditLimitCentavos: number | null }

export function CustomerFormDialog({ storeId, trigger, initial, canSetLimit, defaultOpen }: { storeId: string; trigger: React.ReactNode; initial?: CustomerValues; canSetLimit: boolean; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<number | null>(initial?.creditLimitCentavos ?? null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: fd.get("name"), phone: fd.get("phone") || null, address: fd.get("address") || null, notes: fd.get("notes") || null };
    if (canSetLimit) body.creditLimitCentavos = limit;
    setBusy(true);
    try {
      const c = await api<{ id: string }>(initial?.id ? `/api/v1/stores/${storeId}/customers/${initial.id}` : `/api/v1/stores/${storeId}/customers`, { method: initial?.id ? "PATCH" : "POST", json: body });
      toast.success(initial?.id ? "Customer updated" : "Customer added");
      setOpen(false);
      router.push(`/customers/${c.id}`);
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
        <DialogHeader><DialogTitle>{initial?.id ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field id="c-name" label="Name" error={errors.name}><Input id="c-name" name="name" defaultValue={initial?.name} autoFocus /></Field>
          <Field id="c-phone" label="Mobile (optional)" error={errors.phone}><Input id="c-phone" name="phone" type="tel" inputMode="tel" defaultValue={initial?.phone ?? ""} placeholder="09171234567" /></Field>
          <Field id="c-address" label="Address / landmark (optional)" error={errors.address}><Input id="c-address" name="address" defaultValue={initial?.address ?? ""} /></Field>
          {canSetLimit && (
            <Field id="c-limit" label="Utang limit (optional)" error={errors.creditLimitCentavos} hint="Leave blank for no limit">
              <MoneyInput id="c-limit" defaultCentavos={initial?.creditLimitCentavos} onCentavos={setLimit} />
            </Field>
          )}
          <Field id="c-notes" label="Notes (optional)" error={errors.notes}><Input id="c-notes" name="notes" defaultValue={initial?.notes ?? ""} /></Field>
          <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
