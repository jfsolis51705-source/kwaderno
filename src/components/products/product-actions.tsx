"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, PackageOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/app/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";

export function ArchiveButton({ storeId, productId, archived }: { storeId: string; productId: string; archived: boolean }) {
  const router = useRouter();
  return archived ? (
    <Button variant="outline" onClick={async () => {
      await api(`/api/v1/stores/${storeId}/products/${productId}/archive`, { method: "DELETE" }).then(() => toast.success("Product restored"), (e) => toast.error(e.message));
      router.refresh();
    }}>
      <ArchiveRestore /> Restore
    </Button>
  ) : (
    <ConfirmationDialog
      title="Archive this product?"
      description="It will be hidden from selling and stock-in. Its stock history and past sales are kept, and you can restore it anytime."
      confirmLabel="Archive"
      destructive
      onConfirm={async () => {
        await api(`/api/v1/stores/${storeId}/products/${productId}/archive`, { method: "POST" }).then(() => toast.success("Product archived"), (e) => toast.error(e.message));
        router.refresh();
      }}
      trigger={<Button variant="outline"><Archive /> Archive</Button>}
    />
  );
}

export function OpenPackButton({ storeId, productId, childName, perPack, childUnit }: { storeId: string; productId: string; childName: string; perPack: number; childUnit: string }) {
  const router = useRouter();
  const key = useRef(newIdempotencyKey());
  return (
    <ConfirmationDialog
      title="Open 1 pack?"
      description={`This removes 1 from this product's stock and adds ${perPack} ${childUnit} to "${childName}".`}
      confirmLabel="Open pack"
      onConfirm={async () => {
        try {
          await api(`/api/v1/stores/${storeId}/inventory/repack`, { method: "POST", json: { packProductId: productId, packs: 1, idempotencyKey: key.current } });
          key.current = newIdempotencyKey();
          toast.success(`Added ${perPack} ${childUnit} to ${childName}`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
      trigger={<Button variant="outline"><PackageOpen /> Open 1 pack</Button>}
    />
  );
}

export function BarcodeManager({ storeId, productId, barcodes, canRemove }: { storeId: string; productId: string; barcodes: string[]; canRemove: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const code = draft.trim();
    if (code.length < 3) return;
    setBusy(true);
    try {
      await api(`/api/v1/stores/${storeId}/products/${productId}/barcodes`, { method: "POST", json: { barcode: code } });
      setDraft("");
      toast.success("Barcode added");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {barcodes.length === 0 ? <p className="text-muted-foreground text-sm">No barcode yet.</p> : (
        <ul className="space-y-1">
          {barcodes.map((b) => (
            <li key={b} className="flex items-center justify-between gap-2">
              <Badge variant="secondary" className="num py-1 text-sm">{b}</Badge>
              {canRemove && (
                <ConfirmationDialog
                  title="Remove this barcode?"
                  description={`Scanning ${b} will no longer find this product.`}
                  confirmLabel="Remove"
                  destructive
                  onConfirm={async () => {
                    await api(`/api/v1/stores/${storeId}/products/${productId}/barcodes/${encodeURIComponent(b)}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
                    router.refresh();
                  }}
                  trigger={<Button variant="ghost" size="icon" aria-label={`Remove barcode ${b}`}><Trash2 className="text-destructive" /></Button>}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} inputMode="numeric" placeholder="Type or scan a barcode" aria-label="New barcode" />
        <Button variant="outline" className="h-11" onClick={add} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
      </div>
    </div>
  );
}
