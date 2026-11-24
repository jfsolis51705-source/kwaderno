"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Printer } from "lucide-react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/app/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export function SaleActions({ storeId, saleId, canVoid, autoPrint }: { storeId: string; saleId: string; canVoid: boolean; autoPrint: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (autoPrint) setTimeout(() => window.print(), 300);
  }, [autoPrint]);
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      {canVoid && (
        <ConfirmationDialog
          destructive
          title="Void this sale?"
          description={
            <div className="space-y-2">
              <p>Stock will be returned and any utang from this sale removed. The sale stays in the history marked as voided.</p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Void reason" />
            </div>
          }
          confirmLabel="Void sale"
          onConfirm={async () => {
            try {
              await api(`/api/v1/stores/${storeId}/sales/${saleId}/void`, { method: "POST", json: { reason } });
              toast.success("Sale voided");
              router.refresh();
            } catch (e) {
              toast.error((e as Error).message);
              throw e;
            }
          }}
          trigger={<Button variant="outline"><Ban /> Void sale</Button>}
        />
      )}
    </div>
  );
}
