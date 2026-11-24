"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";

export function ExpiryActions({ storeId, id, name, unit, quantity }: { storeId: string; id: string; name: string; unit: string; quantity: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(quantity ? String(quantity) : "");
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  async function clear(reason: "sold_out" | "disposed" | "returned") {
    setBusy(true);
    try {
      await api(`/api/v1/stores/${storeId}/expiries/${id}/clear`, { method: "POST", json: { reason, quantity: reason === "disposed" ? Number(qty) || null : null, idempotencyKey: key.current } });
      toast.success(reason === "disposed" ? `Removed ${qty} ${unit} of ${name} from stock` : "Batch closed");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => clear("sold_out")}>Sold out</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => clear("returned")}>Returned</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="destructive"><Trash2 /> Dispose</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Throw away expired {name}?</DialogTitle>
            <DialogDescription>This removes the units from stock as &quot;expired&quot; and is recorded in the stock history.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm">Units to remove ({unit})<Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" autoFocus /></label>
          <Button variant="destructive" size="lg" disabled={busy || !(Number(qty) > 0)} onClick={() => clear("disposed")}>{busy && <Loader2 className="animate-spin" />} Remove {qty || ""} {unit} from stock</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
