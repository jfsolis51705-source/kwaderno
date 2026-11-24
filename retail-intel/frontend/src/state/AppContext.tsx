import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, auth, NetworkError, type Me } from "../lib/api";
import { applyLocalAdjust, enqueueCapture, enqueueOp, flushQueue, loadCachedProducts, pendingEntries, saveCachedProducts, statusOf } from "../lib/offline";
import type { Capture, CaptureKind, Product, QueueEntry, Store } from "../lib/types";
import { kv, queueStore } from "../lib/idb";

interface Ctx {
  me: Me | null; authReady: boolean; role: "owner" | "staff" | "ops" | null;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { email: string; password: string; name: string; store_name: string; barangay?: string; city?: string }) => Promise<void>;
  logout: () => Promise<void>;
  stores: Store[]; storeId: number | null; setStoreId: (id: number) => void; store: Store | undefined;
  products: Product[]; refreshProducts: () => Promise<void>;
  online: boolean; queue: QueueEntry[]; syncing: boolean; syncNow: () => Promise<void>; refreshQueue: () => Promise<void>;
  adjustStock: (ref: { sku?: string; barcode?: string }, delta: number, reason: "barcode" | "manual") => Promise<Product | null>;
  saveProduct: (p: { sku: string; name: string; brand?: string; variant?: string; barcode?: string; price?: number; cost?: number; reorder_level?: number; qty_on_hand?: number }) => Promise<void>;
  editProduct: (p: Product, patch: Partial<Pick<Product, "name" | "brand" | "variant" | "barcode" | "price" | "cost" | "reorder_level">>) => Promise<void>;
  submitCapture: (kind: CaptureKind, file: Blob, name: string) => Promise<Capture | "queued">;
  toast: (msg: string, tone?: "ok" | "warn" | "err") => void; toastMsg: { msg: string; tone: string } | null;
  visionProvider: string; distributors: string[];
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error("useApp outside provider"); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreIdState] = useState<number | null>(() => { const v = localStorage.getItem("ri-store"); return v ? Number(v) : null; });
  const [products, setProducts] = useState<Product[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [toastMsg, setToast] = useState<{ msg: string; tone: string } | null>(null);
  const [meta, setMeta] = useState({ visionProvider: "…", distributors: ["Super8", "Suy Sing"] });
  const toastT = useRef<number>();
  const productsRef = useRef(products); productsRef.current = products;

  const toast = useCallback((msg: string, tone: "ok" | "warn" | "err" = "ok") => {
    setToast({ msg, tone }); window.clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  const setStoreId = (id: number) => { localStorage.setItem("ri-store", String(id)); setStoreIdState(id); };
  const refreshQueue = useCallback(async () => setQueue(await pendingEntries()), []);
  const setLocal = useCallback(async (sid: number, ps: Product[]) => { setProducts(ps); await saveCachedProducts(sid, ps); }, []);

  const refreshProducts = useCallback(async () => {
    if (!storeId || !auth.token()) return;
    try { const ps = await api.products(storeId); await setLocal(storeId, ps); setOnline(true); }
    catch (e) { if (e instanceof NetworkError) { setOnline(false); setProducts(await loadCachedProducts(storeId)); } }
  }, [storeId, setLocal]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await flushQueue();
      if (r.offline) { setOnline(false); toast("Still offline — will sync when the connection is back", "warn"); }
      else { setOnline(true); if (r.sent || r.failed) toast(r.failed ? `Synced ${r.sent}, ${r.failed} need attention` : `Synced ${r.sent} change(s)`, r.failed ? "warn" : "ok"); await refreshProducts(); }
    } finally { setSyncing(false); await refreshQueue(); }
  }, [refreshProducts, refreshQueue, toast]);

  const applyMe = useCallback(async (m: Me) => {
    setMe(m); setStores(m.stores); await kv.set("me", m);
    const keep = m.stores.some((s) => s.id === Number(localStorage.getItem("ri-store")));
    if (!keep && m.stores[0]) setStoreId(m.stores[0].id);
  }, []);

  // boot: who am I (cached for offline use), vision/distributor info, queue
  useEffect(() => {
    (async () => {
      api.health().then((h) => setMeta({ visionProvider: h.vision_provider, distributors: h.distributors })).catch(() => setOnline(false));
      if (auth.token()) {
        try { await applyMe(await api.me()); }
        catch (e) {
          if (e instanceof NetworkError) { setOnline(false); const cached = await kv.get<Me>("me"); if (cached) { setMe(cached); setStores(cached.stores); } }
          else auth.set(null);
        }
      }
      setAuthReady(true);
      await refreshQueue();
    })();
    const onUnauthorized = () => { auth.set(null); setMe(null); };
    window.addEventListener("ri-unauthorized", onUnauthorized);
    return () => window.removeEventListener("ri-unauthorized", onUnauthorized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login: Ctx["login"] = async (email, password) => { const r = await api.login(email, password); auth.set(r.token); await applyMe(r); };
  const register: Ctx["register"] = async (b) => { const r = await api.register(b); auth.set(r.token); await applyMe(r); };
  const logout: Ctx["logout"] = async () => {
    try { await api.logout(); } catch { /* offline: the token is still forgotten locally */ }
    auth.set(null); setMe(null); setStores([]); setProducts([]);
    // forget this account's cached data and unsent changes on this device
    for (const k of ["me", ...stores.map((s) => `products:${s.id}`), ...stores.map((s) => `orders:${s.id}`), ...stores.map((s) => `rewards:${s.id}`)]) await kv.del(k);
    await queueStore.clear(); await refreshQueue();
    localStorage.removeItem("ri-store");
  };
  useEffect(() => { refreshProducts(); }, [refreshProducts]);
  useEffect(() => {
    const on = () => { setOnline(true); syncNow(); }, off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const t = window.setInterval(() => { if (navigator.onLine) pendingEntries().then((q) => { if (q.length) syncNow(); }); }, 30000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.clearInterval(t); };
  }, [syncNow]);

  const adjustStock: Ctx["adjustStock"] = async (ref, delta, reason) => {
    if (!storeId) return null;
    if (navigator.onLine) {
      try {
        const p = await api.adjust(storeId, ref, delta, reason);
        await setLocal(storeId, productsRef.current.map((x) => (x.id === p.id ? p : x)));
        return p;
      } catch (e) { if (!(e instanceof NetworkError)) throw e; setOnline(false); }
    }
    const { products: next, product } = applyLocalAdjust(productsRef.current, ref, delta);
    if (!product) throw new ApiError(404, "Not in this store's catalog (offline)");
    await setLocal(storeId, next);
    await enqueueOp(storeId, "adjust", { sku: product.sku, delta, reason });
    await refreshQueue();
    return product;
  };

  const saveProduct: Ctx["saveProduct"] = async (p) => {
    if (!storeId) return;
    if (navigator.onLine) {
      try { await api.createProduct(storeId, p); await refreshProducts(); return; }
      catch (e) { if (!(e instanceof NetworkError)) throw e; setOnline(false); }
    }
    const local: Product = { id: -Date.now(), store_id: storeId, sku: p.sku, name: p.name, brand: p.brand ?? null, variant: p.variant ?? null, barcode: p.barcode ?? null,
      price: p.price ?? 0, cost: p.cost ?? 0, reorder_level: p.reorder_level ?? 5, qty_on_hand: p.qty_on_hand ?? 0, status: statusOf(p.qty_on_hand ?? 0, p.reorder_level ?? 5), thumbnail_url: null, updated_at: null };
    await setLocal(storeId, [...productsRef.current.filter((x) => x.sku !== p.sku), local]);
    await enqueueOp(storeId, "product_upsert", p as Record<string, unknown>);
    await refreshQueue();
  };

  const editProduct: Ctx["editProduct"] = async (p, patch) => {
    if (!storeId) return;
    if (navigator.onLine && p.id > 0) {
      try { const np = await api.patchProduct(p.id, patch); await setLocal(storeId, productsRef.current.map((x) => (x.id === np.id ? np : x))); return; }
      catch (e) { if (!(e instanceof NetworkError)) throw e; setOnline(false); }
    }
    const np = { ...p, ...patch } as Product; np.status = statusOf(np.qty_on_hand, np.reorder_level);
    await setLocal(storeId, productsRef.current.map((x) => (x.sku === p.sku ? np : x)));
    await enqueueOp(storeId, "product_patch", { sku: p.sku, ...patch });
    await refreshQueue();
  };

  const submitCapture: Ctx["submitCapture"] = async (kind, file, name) => {
    if (!storeId) throw new Error("Choose a store first");
    if (navigator.onLine) {
      try { return await api.uploadCapture(storeId, kind, file, undefined, name); }
      catch (e) { if (!(e instanceof NetworkError)) throw e; setOnline(false); }
    }
    await enqueueCapture(storeId, kind, file, name);
    await refreshQueue();
    return "queued";
  };

  const role = (stores as (Store & { role?: Ctx["role"] })[]).find((s) => s.id === storeId)?.role ?? (me?.user.role === "ops" ? "ops" : null);
  const value = useMemo<Ctx>(() => ({
    me, authReady, role, login, register, logout,
    stores, storeId, setStoreId, store: stores.find((s) => s.id === storeId), products, refreshProducts, online, queue, syncing, syncNow, refreshQueue,
    adjustStock, saveProduct, editProduct, submitCapture, toast, toastMsg, visionProvider: meta.visionProvider, distributors: meta.distributors,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [me, authReady, role, stores, storeId, products, online, queue, syncing, toastMsg, meta, refreshProducts, syncNow, refreshQueue, toast]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
