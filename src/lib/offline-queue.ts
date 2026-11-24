"use client";
import { openDB, type IDBPDatabase } from "idb";

/**
 * Durable on-device queue of operations made while offline (IndexedDB).
 * Each operation has a client-generated UUID that the server uses as its
 * idempotency key, so re-sending is always safe.
 */
export type OpType = "sale.create" | "inventory.adjust" | "customer.payment";
export type OpStatus = "pending" | "syncing" | "conflict" | "failed" | "synced";
export interface QueuedOp {
  operationId: string;
  storeId: string;
  opType: OpType;
  payload: Record<string, unknown>;
  summary: string;
  status: OpStatus;
  attempts: number;
  error?: string;
  result?: unknown;
  clientCreatedAt: string;
  updatedAt: string;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB("kwaderno", 1, {
    upgrade(d) {
      const s = d.createObjectStore("ops", { keyPath: "operationId" });
      s.createIndex("store", "storeId");
    },
  });
  return dbp;
}

const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version++;
  listeners.forEach((l) => l());
  try {
    new BroadcastChannel("kwaderno-queue").postMessage("changed");
  } catch {
    /* older browsers */
  }
}
if (typeof window !== "undefined") {
  try {
    new BroadcastChannel("kwaderno-queue").onmessage = () => {
      version++;
      listeners.forEach((l) => l());
    };
  } catch {
    /* older browsers */
  }
}
export const subscribeQueue = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const queueVersion = () => version;

export async function enqueue(op: Omit<QueuedOp, "status" | "attempts" | "clientCreatedAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const full: QueuedOp = { ...op, status: "pending", attempts: 0, clientCreatedAt: now, updatedAt: now };
  await (await db()).put("ops", full);
  changed();
  return full;
}

export async function listOps(storeId: string): Promise<QueuedOp[]> {
  const all = (await (await db()).getAllFromIndex("ops", "store", storeId)) as QueuedOp[];
  return all.sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt));
}

export async function updateOp(operationId: string, patch: Partial<QueuedOp>) {
  const d = await db();
  const cur = (await d.get("ops", operationId)) as QueuedOp | undefined;
  if (!cur) return;
  await d.put("ops", { ...cur, ...patch, updatedAt: new Date().toISOString() });
  changed();
}

/** Removes an operation the user chose to discard (only allowed for unsynced ones). */
export async function discardOp(operationId: string) {
  const d = await db();
  const cur = (await d.get("ops", operationId)) as QueuedOp | undefined;
  if (cur && cur.status !== "synced") await d.delete("ops", operationId);
  changed();
}

/** Keeps the device tidy: synced operations older than a week are removed. */
export async function pruneSynced(storeId: string) {
  const cutoff = Date.now() - 7 * 864e5;
  for (const op of await listOps(storeId)) if (op.status === "synced" && Date.parse(op.updatedAt) < cutoff) await (await db()).delete("ops", op.operationId);
}

export function deviceId() {
  try {
    let id = localStorage.getItem("kw_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("kw_device_id", id);
    }
    return id;
  } catch {
    return "unknown-device-" + Math.random().toString(36).slice(2);
  }
}
