/**
 * Offline-first sync queue.
 * - Stock adjustments and product edits made offline are stored as ops and sent in one /api/sync batch
 *   (each op has a unique op_id, so retries never double-apply).
 * - Photos taken offline are stored as Blobs and uploaded with client_id = queue id (also idempotent).
 */
import { api, NetworkError } from "./api";
import { kv, queueStore } from "./idb";
import type { Capture, CaptureKind, Product, QueueEntry, QueuedCapture, QueuedOp, SyncOpType } from "./types";

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export async function enqueueOp(storeId: number, type: SyncOpType, payload: Record<string, unknown>): Promise<QueuedOp> {
  const e: QueuedOp = { id: newId(), kind: "op", storeId, type, payload, createdAt: new Date().toISOString(), seq: ++seq };
  await queueStore.put(e);
  return e;
}

const toBytes = (b: Blob): Promise<ArrayBuffer> => (typeof b.arrayBuffer === "function" ? b.arrayBuffer() : new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b);
}));

export async function enqueueCapture(storeId: number, captureKind: CaptureKind, blob: Blob, fileName: string): Promise<QueuedCapture> {
  // stored as bytes (not a Blob) so it survives in every browser's IndexedDB
  const e: QueuedCapture = { id: newId(), kind: "capture", storeId, captureKind, data: await toBytes(blob), mime: blob.type || "image/jpeg", fileName, createdAt: new Date().toISOString() };
  await queueStore.put(e);
  return e;
}

export const pendingEntries = () => queueStore.all<QueueEntry>().then((xs) => xs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0)));
let seq = 0;
export const removeEntry = (id: string) => queueStore.del(id);

export interface FlushResult { sent: number; failed: number; offline: boolean; captures: Capture[] }

/** Sends everything that is queued. Network failures keep entries for later; server rejections are marked with an error. */
export async function flushQueue(): Promise<FlushResult> {
  const entries = await pendingEntries();
  const out: FlushResult = { sent: 0, failed: 0, offline: false, captures: [] };
  const byStore = new Map<number, QueuedOp[]>();
  for (const e of entries) if (e.kind === "op") byStore.set(e.storeId, [...(byStore.get(e.storeId) ?? []), e]);
  for (const [storeId, ops] of byStore) {
    try {
      const res = await api.sync(storeId, ops.map((o) => ({ op_id: o.id, type: o.type, payload: o.payload })));
      for (const r of res.results) {
        const op = ops.find((o) => o.id === r.op_id)!;
        if (r.ok) { await removeEntry(op.id); out.sent++; } else { await queueStore.put({ ...op, error: r.error ?? "Rejected" }); out.failed++; }
      }
    } catch (e) {
      if (e instanceof NetworkError) { out.offline = true; return out; }
      for (const op of ops) await queueStore.put({ ...op, error: (e as Error).message });
      out.failed += ops.length;
    }
  }
  for (const e of entries) {
    if (e.kind !== "capture") continue;
    try {
      const c = await api.uploadCapture(e.storeId, e.captureKind, new Blob([e.data], { type: e.mime }), e.id, e.fileName);
      await removeEntry(e.id); out.sent++; out.captures.push(c);
    } catch (err) {
      if (err instanceof NetworkError) { out.offline = true; return out; }
      await queueStore.put({ ...e, error: (err as Error).message }); out.failed++;
    }
  }
  return out;
}

// ---------- local product cache (so the catalog works offline) ----------
export const cacheKey = (storeId: number) => `products:${storeId}`;
export const loadCachedProducts = async (storeId: number) => (await kv.get<Product[]>(cacheKey(storeId))) ?? [];
export const saveCachedProducts = (storeId: number, ps: Product[]) => kv.set(cacheKey(storeId), ps);

export function statusOf(qty: number, reorder: number): Product["status"] {
  return qty <= 0 ? "out" : qty <= reorder ? "low" : "ok";
}

/** Optimistically apply a stock change to the cached catalog (mirrors the server: never below zero). */
export function applyLocalAdjust(ps: Product[], ref: { sku?: string; barcode?: string }, delta: number): { products: Product[]; product?: Product } {
  const i = ps.findIndex((p) => (ref.barcode && p.barcode === ref.barcode) || (ref.sku && p.sku === ref.sku) || (ref.barcode && p.sku === ref.barcode));
  if (i < 0) return { products: ps };
  const p = ps[i];
  const qty = Math.max(0, p.qty_on_hand + delta);
  const next = { ...p, qty_on_hand: qty, status: statusOf(qty, p.reorder_level) };
  const products = ps.slice(); products[i] = next;
  return { products, product: next };
}
