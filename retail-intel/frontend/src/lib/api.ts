import type { AuditEntry, Cashflow, Checkins, Capture, CaptureItem, CaptureKind, CustomerOrder, CustomerOrderStatus, Order, Overview, Product, Rewards, ShopCatalog, ShopSettings, Store } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Thrown when the request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const TOKEN_KEY = "ri-token";
export const auth = {
  token: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  const token = auth.token();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new NetworkError("Can't reach the server");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("ri-unauthorized"));
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (body as { detail?: unknown })?.detail;
    throw new ApiError(res.status, typeof d === "string" ? d : Array.isArray(d) ? "Please check the highlighted values" : `Request failed (${res.status})`);
  }
  return body as T;
}
const json = (method: string, data: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

export interface Me { user: { id: number; email: string; name: string; role: "merchant" | "ops" }; stores: (Store & { role: "owner" | "staff" | "ops" })[] }

export const api = {
  register: (b: { email: string; password: string; name: string; store_name: string; barangay?: string; city?: string }) => call<Me & { token: string }>("/api/auth/register", json("POST", b)),
  login: (email: string, password: string) => call<Me & { token: string }>("/api/auth/login", json("POST", { email, password })),
  logout: () => call<string>("/api/auth/logout", { method: "POST" }),
  me: () => call<Me>("/api/auth/me"),
  members: (storeId: number) => call<{ id: number; name: string; email: string; role: string }[]>(`/api/stores/${storeId}/members`),
  addMember: (storeId: number, b: { email: string; name: string; password?: string; role?: "staff" | "owner" }) => call<{ id: number }>(`/api/stores/${storeId}/members`, json("POST", b)),
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
  checkins: (storeId: number) => call<Checkins>(`/api/stores/${storeId}/checkins`),
  cashflow: (storeId: number) => call<Cashflow>(`/api/stores/${storeId}/cashflow`),
  rewards: (storeId: number) => call<Rewards>(`/api/stores/${storeId}/rewards`),
  sync: (storeId: number, ops: { op_id: string; type: string; payload: Record<string, unknown> }[]) =>
    call<{ results: { op_id: string; ok: boolean; duplicate?: boolean; error?: string; product?: Product }[] }>("/api/sync", json("POST", { store_id: storeId, ops })),
  overview: () => call<Overview>("/api/portal/overview"),
  audit: (storeId?: number) => call<AuditEntry[]>(`/api/portal/audit${storeId ? `?store_id=${storeId}` : ""}`),
  // online ordering
  shopSettings: (storeId: number) => call<ShopSettings>(`/api/stores/${storeId}/shop`),
  saveShop: (storeId: number, b: Omit<ShopSettings, "store_id" | "path">) => call<ShopSettings>(`/api/stores/${storeId}/shop`, json("PUT", b)),
  customerOrders: (storeId: number, status?: string) => call<CustomerOrder[]>(`/api/stores/${storeId}/customer-orders${status ? `?status=${status}` : ""}`),
  customerOrderStatus: (id: number, status: Exclude<CustomerOrderStatus, "new">) => call<CustomerOrder>(`/api/customer-orders/${id}/status`, json("POST", { status })),
  // public (no login)
  shop: (slug: string) => call<ShopCatalog>(`/api/shop/${encodeURIComponent(slug)}`),
  placeOrder: (slug: string, b: { name: string; phone: string; fulfillment: "pickup" | "delivery"; address?: string; note?: string; items: { product_id: number; qty: number }[]; website?: string }) =>
    call<CustomerOrder>(`/api/shop/${encodeURIComponent(slug)}/orders`, json("POST", b)),
  publicOrder: (slug: string, code: string, token: string) => call<CustomerOrder>(`/api/shop/${encodeURIComponent(slug)}/orders/${encodeURIComponent(code)}?t=${encodeURIComponent(token)}`),
};
