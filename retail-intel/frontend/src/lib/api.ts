import type { AuditEntry, Capture, CaptureItem, CaptureKind, Order, Overview, Product, Rewards, Store } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Thrown when the request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new NetworkError("Can't reach the server");
  }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (body as { detail?: unknown })?.detail;
    throw new ApiError(res.status, typeof d === "string" ? d : Array.isArray(d) ? "Please check the highlighted values" : `Request failed (${res.status})`);
  }
  return body as T;
}
const json = (method: string, data: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

export const api = {
  health: () => call<{ ok: boolean; vision_provider: string; distributors: string[] }>("/api/health"),
  stores: () => call<Store[]>("/api/stores"),
  products: (storeId: number) => call<Product[]>(`/api/stores/${storeId}/products`),
  createProduct: (storeId: number, p: Partial<Product> & { sku: string; name: string }) => call<Product>(`/api/stores/${storeId}/products`, json("POST", p)),
  patchProduct: (id: number, p: Partial<Pick<Product, "name" | "brand" | "variant" | "barcode" | "price" | "cost" | "reorder_level">>) => call<Product>(`/api/products/${id}`, json("PATCH", p)),
  uploadThumbnail: (id: number, file: Blob) => { const f = new FormData(); f.append("file", file, "thumb.jpg"); return call<Product>(`/api/products/${id}/thumbnail`, { method: "POST", body: f }); },
  lookup: (storeId: number, code: string) => call<Product>(`/api/stores/${storeId}/lookup?code=${encodeURIComponent(code)}`),
  adjust: (storeId: number, ref: { sku?: string; barcode?: string }, delta: number, reason: "barcode" | "manual") =>
    call<Product>("/api/inventory/adjust", json("POST", { store_id: storeId, ...ref, delta, reason })),
  uploadCapture: (storeId: number, kind: CaptureKind, file: Blob, clientId?: string, fileName = "photo.jpg") => {
    const f = new FormData(); f.append("store_id", String(storeId)); f.append("kind", kind); if (clientId) f.append("client_id", clientId); f.append("file", file, fileName);
    return call<Capture>("/api/captures", { method: "POST", body: f });
  },
  captures: (q: { storeId?: number; status?: string } = {}) => call<Capture[]>(`/api/captures?${new URLSearchParams({ ...(q.storeId ? { store_id: String(q.storeId) } : {}), ...(q.status ? { status: q.status } : {}) })}`),
  confirmCapture: (id: number, items: CaptureItem[], awardLowQuality = false) => call<Capture>(`/api/captures/${id}/confirm`, json("POST", { items, award_low_quality: awardLowQuality })),
  rejectCapture: (id: number, reason: string) => { const f = new FormData(); f.append("reason", reason); return call<Capture>(`/api/captures/${id}/reject`, { method: "POST", body: f }); },
  orders: (q: { storeId?: number; status?: string } = {}) => call<Order[]>(`/api/orders?${new URLSearchParams({ ...(q.storeId ? { store_id: String(q.storeId) } : {}), ...(q.status ? { status: q.status } : {}) })}`),
  draftOrder: (storeId: number, distributor: string) => call<Order>("/api/orders/draft", json("POST", { store_id: storeId, distributor })),
  patchOrder: (id: number, p: { distributor?: string; note?: string; lines?: { product_id: number; qty: number }[] }) => call<Order>(`/api/orders/${id}`, json("PATCH", p)),
  orderStatus: (id: number, status: "submitted" | "fulfilled" | "cancelled") => call<Order>(`/api/orders/${id}/status`, json("POST", { status })),
  rewards: (storeId: number) => call<Rewards>(`/api/stores/${storeId}/rewards`),
  sync: (storeId: number, ops: { op_id: string; type: string; payload: Record<string, unknown> }[]) =>
    call<{ results: { op_id: string; ok: boolean; duplicate?: boolean; error?: string; product?: Product }[] }>("/api/sync", json("POST", { store_id: storeId, ops })),
  overview: () => call<Overview>("/api/portal/overview"),
  audit: (storeId?: number) => call<AuditEntry[]>(`/api/portal/audit${storeId ? `?store_id=${storeId}` : ""}`),
};
