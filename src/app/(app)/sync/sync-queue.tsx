"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CloudOff, Loader2, RefreshCw, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { ConfirmationDialog } from "@/components/app/confirmation-dialog";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listOps, queueVersion, subscribeQueue, type QueuedOp } from "@/lib/offline-queue";
import { discardOp, retryOp, syncNow } from "@/lib/sync-client";

const LABEL: Record<QueuedOp["opType"], string> = { "sale.create": "Sale", "inventory.adjust": "Stock adjustment", "customer.payment": "Utang payment" };
const fmt = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Operations saved on THIS device. Conflicts wait for a person: retry (e.g. after stock-in) or discard. */
export function SyncQueue({ storeId }: { storeId: string }) {
  const v = useSyncExternalStore(subscribeQueue, queueVersion, () => 0);
  const [ops, setOps] = useState<QueuedOp[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listOps(storeId).then((o) => setOps(o.reverse())).catch(() => setOps([]));
  }, [storeId, v]);

  if (!ops) return <p className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Loading this device&apos;s queue…</p>;
  const waiting = ops.filter((o) => o.status !== "synced");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); await syncNow(storeId).catch(() => {}); setBusy(false); }}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
        </Button>
        <span className="text-muted-foreground text-sm">{waiting.length ? `${waiting.length} item(s) not yet on the server` : "Everything on this phone is synced."}</span>
      </div>
      {ops.length === 0 ? (
        <EmptyState icon={CloudOff} title="Nothing saved offline" description="When there is no internet, sales are kept on this phone and listed here until they sync." />
      ) : (
        <ul className="bg-card divide-y rounded-xl border">
          {ops.map((o) => (
            <li key={o.operationId} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{LABEL[o.opType]} · {o.summary}</p>
                <p className="text-muted-foreground text-xs">Saved {fmt.format(new Date(o.clientCreatedAt))}{o.attempts ? ` · ${o.attempts} attempt(s)` : ""}</p>
                {o.error && <p className="text-destructive text-xs">{o.error}</p>}
              </div>
              {o.status === "synced" && <Badge variant="success"><CheckCircle2 /> Synced</Badge>}
              {(o.status === "pending" || o.status === "syncing") && <Badge variant="secondary">{o.status === "syncing" ? <Loader2 className="animate-spin" /> : null} Waiting</Badge>}
              {o.status === "failed" && <Badge variant="warning">Will retry</Badge>}
              {o.status === "conflict" && (
                <>
                  <Badge variant="destructive"><TriangleAlert /> Needs attention</Badge>
                  <Button size="sm" variant="outline" onClick={() => retryOp(storeId, o)}><RotateCcw /> Retry</Button>
                  <ConfirmationDialog
                    destructive
                    title="Discard this offline item?"
                    description="It was never recorded on the server. Discarding removes it from this phone for good. Make sure stock and cash are corrected another way."
                    confirmLabel="Discard"
                    onConfirm={() => discardOp(o.operationId)}
                    trigger={<Button size="sm" variant="ghost"><Trash2 className="text-destructive" /> Discard</Button>}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
