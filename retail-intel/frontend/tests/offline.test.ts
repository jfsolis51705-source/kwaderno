import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests } from "../src/lib/idb";
import { applyLocalAdjust, enqueueCapture, enqueueOp, flushQueue, loadCachedProducts, pendingEntries, saveCachedProducts, statusOf } from "../src/lib/offline";
import type { Product } from "../src/lib/types";

const product = (o: Partial<Product> = {}): Product => ({ id: 1, store_id: 1, sku: "COKE-MISMO", name: "Coke", brand: "Coca-Cola", variant: null, barcode: "4801", price: 20, cost: 17,
  reorder_level: 6, qty_on_hand: 8, status: "ok", thumbnail_url: null, updated_at: null, ...o });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetDbForTests(); });
afterEach(() => vi.restoreAllMocks());

describe("stock status", () => {
  it("matches the server rules", () => {
    expect(statusOf(0, 5)).toBe("out"); expect(statusOf(5, 5)).toBe("low"); expect(statusOf(6, 5)).toBe("ok");
  });
  it("applies offline adjustments by barcode or SKU and never below zero", () => {
    const { products, product: p } = applyLocalAdjust([product()], { barcode: "4801" }, -3);
    expect(p?.qty_on_hand).toBe(5); expect(p?.status).toBe("low"); expect(products[0].qty_on_hand).toBe(5);
    expect(applyLocalAdjust(products, { sku: "COKE-MISMO" }, -99).product?.qty_on_hand).toBe(0);
    expect(applyLocalAdjust(products, { sku: "NOPE" }, 1).product).toBeUndefined();
  });
});

describe("offline queue", () => {
  it("caches products for offline use", async () => {
    await saveCachedProducts(7, [product()]);
    expect((await loadCachedProducts(7))[0].sku).toBe("COKE-MISMO");
    expect(await loadCachedProducts(8)).toEqual([]);
  });

  it("keeps everything when the network is down", async () => {
    await enqueueOp(1, "adjust", { sku: "COKE-MISMO", delta: 1 });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await flushQueue();
    expect(r.offline).toBe(true);
    expect(await pendingEntries()).toHaveLength(1);
  });

  it("sends ops in one batch with their ids, removes the accepted ones and marks the rejected", async () => {
    const a = await enqueueOp(1, "adjust", { sku: "COKE-MISMO", delta: 2 });
    const b = await enqueueOp(1, "adjust", { sku: "MISSING", delta: 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.store_id).toBe(1);
      expect(body.ops.map((o: { op_id: string }) => o.op_id).sort()).toEqual([a.id, b.id].sort());
      return jsonRes({ results: [{ op_id: a.id, ok: true, product: product({ qty_on_hand: 10 }) }, { op_id: b.id, ok: false, error: "No product" }] });
    });
    const r = await flushQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ sent: 1, failed: 1, offline: false });
    const left = await pendingEntries();
    expect(left).toHaveLength(1); expect(left[0].id).toBe(b.id); expect(left[0].error).toBe("No product");
  });

  it("uploads queued photos with the queue id as an idempotency key", async () => {
    const e = await enqueueCapture(3, "receipt", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "r.jpg");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("/api/captures");
      const fd = (init as RequestInit).body as FormData;
      expect(fd.get("client_id")).toBe(e.id); expect(fd.get("kind")).toBe("receipt"); expect(fd.get("store_id")).toBe("3");
      return jsonRes({ id: 99, status: "pending_review", items: [] }, 201);
    });
    const r = await flushQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.captures[0].id).toBe(99);
    expect(await pendingEntries()).toHaveLength(0);
  });
});
