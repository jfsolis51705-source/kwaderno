"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listOps, queueVersion, subscribeQueue } from "@/lib/offline-queue";
import { syncNow } from "@/lib/sync-client";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Connectivity + offline queue indicator, and the sync engine:
 * syncs on load, when the device comes back online, and every 30 s while items wait.
 */
export function SyncStatusBadge({ storeId }: { storeId: string }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const v = useSyncExternalStore(subscribeQueue, queueVersion, () => 0);
  const [counts, setCounts] = useState({ pending: 0, problems: 0 });

  useEffect(() => {
    let alive = true;
    listOps(storeId)
      .then((ops) => alive && setCounts({ pending: ops.filter((o) => o.status === "pending" || o.status === "syncing" || o.status === "failed").length, problems: ops.filter((o) => o.status === "conflict").length }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [storeId, v]);

  useEffect(() => {
    const run = () => void syncNow(storeId).catch(() => {});
    run();
    window.addEventListener("online", run);
    const t = setInterval(run, 30_000);
    return () => {
      window.removeEventListener("online", run);
      clearInterval(t);
    };
  }, [storeId]);

  if (counts.problems) {
    return (
      <Link href="/sync"><Badge variant="destructive" aria-label={`${counts.problems} offline items need attention`}><AlertTriangle /> {counts.problems}<span className="hidden sm:inline"> need attention</span></Badge></Link>
    );
  }
  if (counts.pending) {
    return (
      <Link href="/sync" aria-label={`${counts.pending} items waiting to sync`}><Badge variant="warning">{online ? <RefreshCw className="animate-spin" /> : <CloudOff />} {counts.pending}<span className="hidden sm:inline"> waiting to sync</span></Badge></Link>
    );
  }
  return online ? (
    <Badge variant="success" className="hidden sm:inline-flex"><Cloud /> Online</Badge>
  ) : (
    <Badge variant="warning" aria-label="Offline"><CloudOff /><span className="hidden sm:inline">Offline</span></Badge>
  );
}
