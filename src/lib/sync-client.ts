"use client";
import { discardOp, deviceId, listOps, pruneSynced, updateOp, type QueuedOp } from "./offline-queue";

let running: Promise<void> | null = null;

/** Sends pending (and user-retried) operations in order. Safe to call often; only one run at a time. */
export function syncNow(storeId: string, opts: { includeConflicts?: string[] } = {}) {
  running ??= (async () => {
    try {
      const ops = (await listOps(storeId)).filter((o) => o.status === "pending" || o.status === "failed" || o.status === "syncing" || opts.includeConflicts?.includes(o.operationId));
      if (!ops.length || !navigator.onLine) return;
      for (const o of ops) await updateOp(o.operationId, { status: "syncing", attempts: o.attempts + 1 });
      let res: Response;
      try {
        res = await fetch(`/api/v1/stores/${storeId}/sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            deviceId: deviceId(),
            deviceLabel: navigator.userAgent.slice(0, 120),
            operations: ops.map((o) => ({ operationId: o.operationId, opType: o.opType, payload: o.payload, clientCreatedAt: o.clientCreatedAt })),
          }),
        });
      } catch {
        for (const o of ops) await updateOp(o.operationId, { status: "pending" });
        return;
      }
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error?.message ?? `Server error ${res.status}`;
        for (const o of ops) await updateOp(o.operationId, { status: res.status === 401 ? "pending" : "failed", error: msg });
        return;
      }
      const body = (await res.json()) as { data: { results: { operationId: string; status: "applied" | "conflict" | "failed"; result?: unknown; error?: { message: string } }[] } };
      for (const r of body.data.results) {
        await updateOp(r.operationId, r.status === "applied" ? { status: "synced", result: r.result, error: undefined } : { status: r.status, error: r.error?.message });
      }
      await pruneSynced(storeId);
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function retryOp(storeId: string, op: QueuedOp) {
  await updateOp(op.operationId, { status: "pending", error: undefined });
  return syncNow(storeId, { includeConflicts: [op.operationId] });
}

export { discardOp };
