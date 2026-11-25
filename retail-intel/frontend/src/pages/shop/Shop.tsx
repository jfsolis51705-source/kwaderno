import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { peso, when } from "../../lib/format";
import type { CustomerOrder, ShopCatalog } from "../../lib/types";
import { InstallButton } from "../../components/ui";
import { productShareUrl, shareOrCopy, storeShareUrl } from "../../lib/share";

/** Public store page: no login. Customers browse in-stock items, build a cart and order for pickup or delivery. */
type Cart = Record<number, number>;
const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const STEPS: Record<string, string> = { new: "Natanggap — hinihintay ang tindahan / Received", accepted: "Inihahanda na / Being prepared", ready: "Handa na! / Ready", completed: "Tapos na / Completed", cancelled: "Kinansela / Cancelled" };

export default function Shop() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const focusId = Number(params.get("p")) || null;
  const [note2, setNote2] = useState<string | null>(null);
  const shared = (r: string) => { setNote2(r === "copied" ? "Na-copy ang link · Link copied" : r === "shared" ? null : "I-hold ang link para ma-copy"); if (r !== "shared") window.setTimeout(() => setNote2(null), 2500); };
  const [cat, setCat] = useState<ShopCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(() => ls.get(`shop-cart:${slug}`, {}));
  const [q, setQ] = useState("");
  const [step, setStep] = useState<"menu" | "checkout">("menu");
  const [form, setForm] = useState(() => ls.get(`shop-me`, { name: "", phone: "", address: "" }));
  const [ful, setFul] = useState<"pickup" | "delivery">("pickup");
  const [note, setNote] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ code: string; token: string } | null>(() => ls.get(`shop-last:${slug}`, null));
  const [status, setStatus] = useState<CustomerOrder | null>(null);

  useEffect(() => { api.shop(slug).then((c) => { setCat(c); if (!c.shop.pickup) setFul("delivery"); }).catch((e) => setErr(e instanceof ApiError && e.status === 404 ? "Walang online order ang tindahang ito ngayon. / This store isn't taking online orders." : "Hindi ma-load. Subukan ulit. / Couldn't load — try again.")); }, [slug]);
  useEffect(() => ls.set(`shop-cart:${slug}`, cart), [cart, slug]);
  // this store's own home-screen app: its name, opening straight to its menu
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]'), prev = link?.getAttribute("href");
    link?.setAttribute("href", `/api/shop/${encodeURIComponent(slug)}/manifest.webmanifest`);
    const title = document.title;
    return () => { if (prev) link?.setAttribute("href", prev); document.title = title; };
  }, [slug]);
  useEffect(() => { if (cat) document.title = cat.store.name; }, [cat]);
  // opened from a shared product link: bring that item into view
  useEffect(() => { if (cat && focusId) document.getElementById(`item-${focusId}`)?.scrollIntoView({ block: "center" }); }, [cat, focusId]);
  useEffect(() => {
    if (!placed) return;
    let stop = false;
    const tick = () => api.publicOrder(slug, placed.code, placed.token).then((o) => { if (!stop) setStatus(o); }).catch(() => undefined);
    tick();
    const t = window.setInterval(tick, 15000);
    return () => { stop = true; window.clearInterval(t); };
  }, [placed, slug]);

  const byId = useMemo(() => new Map((cat?.products ?? []).map((p) => [p.id, p])), [cat]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId.get(Number(id)), qty })).filter((l) => l.p && l.qty > 0) as { p: NonNullable<ReturnType<typeof byId.get>>; qty: number }[];
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const fee = ful === "delivery" ? cat?.shop.delivery_fee ?? 0 : 0;
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const setQty = (id: number, n: number) => setCart((c) => { const max = byId.get(id)?.max_qty ?? 0; const v = Math.max(0, Math.min(max, n)); const x = { ...c }; if (v) x[id] = v; else delete x[id]; return x; });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    if (cat && subtotal < cat.shop.min_order) return setFormErr(`Minimum order ${peso(cat.shop.min_order)}`);
    setBusy(true);
    try {
      const o = await api.placeOrder(slug, { name: form.name.trim(), phone: form.phone.replace(/[\s-]/g, ""), fulfillment: ful, address: ful === "delivery" ? form.address : undefined, note: note || undefined, items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })), website: hp || undefined });
      ls.set("shop-me", form);
      const pl = { code: o.code, token: o.token! };
      ls.set(`shop-last:${slug}`, pl);
      setPlaced(pl); setStatus(o); setCart({}); setStep("menu");
    } catch (e2) {
      setFormErr(e2 instanceof ApiError ? (e2.status === 422 ? "Pakisuri ang pangalan at numero (hal. 0917…). / Check your name and mobile number." : e2.message) : "Walang internet — subukan ulit. / No connection — try again.");
      api.shop(slug).then(setCat).catch(() => undefined);
    } finally { setBusy(false); }
  }

  if (err) return <div className="mx-auto grid min-h-screen max-w-md content-center gap-2 px-4 text-center"><div className="text-4xl">🏪</div><p className="text-slate-600">{err}</p></div>;
  if (!cat) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading…</div>;
  const shown = cat.products.filter((p) => !q || `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="bg-brand-600 px-4 pb-4 pt-5 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-start gap-2"><h1 className="flex-1 text-2xl font-bold" data-testid="shop-name">{cat.store.name}</h1><InstallButton label="I-save sa phone" className="btn btn-sm border-white/40 bg-white/15 text-white hover:bg-white/25" /><button className="btn btn-sm border-white/40 bg-white/15 text-white hover:bg-white/25" onClick={async () => shared(await shareOrCopy(storeShareUrl(slug), cat.store.name, `Order online sa ${cat.store.name}`))}>📤 Share</button></div>
          <p className="text-sm opacity-90">{[cat.store.barangay, cat.store.city].filter(Boolean).join(", ")}</p>
          <p className="mt-1 text-sm opacity-90">{cat.shop.pickup ? "🛍️ Pickup" : ""}{cat.shop.pickup && cat.shop.delivery ? " · " : ""}{cat.shop.delivery ? `🛵 Delivery ${cat.shop.delivery_fee ? peso(cat.shop.delivery_fee) : "libre / free"}` : ""}{cat.shop.min_order ? ` · Min ${peso(cat.shop.min_order)}` : ""}</p>
          {cat.shop.note ? <p className="mt-2 rounded-lg bg-white/15 px-3 py-2 text-sm">{cat.shop.note}</p> : null}
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-4">
        {note2 ? <div className="fixed left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" role="status">{note2}</div> : null}
        {focusId && cat.products.every((p) => p.id !== focusId) ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Ubos na ang item na iyon — narito ang iba pang paninda. · That item is sold out; here's what else is in stock.</p> : null}
        {placed && status ? (
          <div className="card border-brand-500" data-testid="order-status">
            <div className="flex items-center gap-2"><div className="text-sm text-slate-500">Order code</div><div className="font-mono text-xl font-bold tracking-widest">{status.code}</div>
              <button className="btn btn-sm ml-auto" onClick={() => { ls.del(`shop-last:${slug}`); setPlaced(null); setStatus(null); }}>Isara / Close</button></div>
            <div className="mt-1 text-lg font-semibold" data-testid="order-status-text">{STEPS[status.status]}</div>
            <div className="text-sm text-slate-600">{status.fulfillment === "pickup" ? "Pickup sa tindahan" : "Delivery"} · {peso(status.total)} · {when(status.created_at)}</div>
            <p className="mt-2 text-xs text-slate-500">Bayad sa tindahan o sa rider (cash o QR Ph ng tindahan). Ipakita ang code. Awtomatikong nag-a-update ang status. / Pay at the store or to the rider; show this code. Status updates automatically.</p>
          </div>
        ) : null}
        {step === "menu" ? (
          <>
            <input className="input" placeholder="Hanapin / Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
            {shown.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {shown.map((p) => {
                  const n = cart[p.id] ?? 0;
                  return (
                    <div key={p.id} id={`item-${p.id}`} className={`card relative flex flex-col gap-2 p-3 ${focusId === p.id ? "ring-2 ring-brand-500" : ""}`} data-testid="shop-item">
                      <button className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-sm shadow" aria-label={`Share ${p.name}`} onClick={async () => shared(await shareOrCopy(productShareUrl(slug, p.id), p.name, `${p.name} — ${peso(p.price)} sa ${cat.store.name}`))}>📤</button>
                      <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-slate-100">{p.thumbnail_url ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="text-3xl" aria-hidden>🛒</span>}</div>
                      <div className="flex-1 text-sm font-semibold leading-tight">{p.name}{p.variant ? <span className="block text-xs font-normal text-slate-500">{p.variant}</span> : null}</div>
                      <div className="font-bold text-brand-700">{peso(p.price)}</div>
                      {n ? (
                        <div className="flex items-center justify-between gap-1"><button className="btn btn-sm" aria-label={`Less ${p.name}`} onClick={() => setQty(p.id, n - 1)}>−</button><span className="font-semibold tabular-nums">{n}</span><button className="btn btn-sm" aria-label={`More ${p.name}`} disabled={n >= p.max_qty} onClick={() => setQty(p.id, n + 1)}>+</button></div>
                      ) : <button className="btn-primary btn-sm" onClick={() => setQty(p.id, 1)}>Idagdag / Add</button>}
                    </div>
                  );
                })}
              </div>
            ) : <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Walang nakita / Nothing found</div>}
          </>
        ) : (
          <form className="grid gap-4 lg:grid-cols-2" onSubmit={submit}>
            <div className="card grid content-start gap-2">
              <h2 className="font-semibold">Iyong order / Your order</h2>
              <ul className="divide-y divide-slate-100">{lines.map((l) => (
                <li key={l.p.id} className="flex items-center gap-2 py-2 text-sm"><span className="flex-1">{l.p.name}</span>
                  <button type="button" className="btn btn-sm" onClick={() => setQty(l.p.id, l.qty - 1)} aria-label={`Less ${l.p.name}`}>−</button><span className="w-6 text-center tabular-nums">{l.qty}</span>
                  <button type="button" className="btn btn-sm" disabled={l.qty >= l.p.max_qty} onClick={() => setQty(l.p.id, l.qty + 1)} aria-label={`More ${l.p.name}`}>+</button><span className="w-20 text-right tabular-nums">{peso(l.p.price * l.qty)}</span></li>))}</ul>
              <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{peso(subtotal)}</span></div>
              {fee ? <div className="flex justify-between text-sm"><span>Delivery</span><span className="tabular-nums">{peso(fee)}</span></div> : null}
              <div className="flex justify-between text-lg font-bold"><span>Total</span><span className="tabular-nums" data-testid="checkout-total">{peso(subtotal + fee)}</span></div>
            </div>
            <div className="card grid content-start gap-3">
              {cat.shop.pickup && cat.shop.delivery ? (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pickup or delivery">
                  {(["pickup", "delivery"] as const).map((f) => <button type="button" key={f} role="radio" aria-checked={ful === f} className={ful === f ? "btn-primary" : "btn"} onClick={() => setFul(f)}>{f === "pickup" ? "🛍️ Pickup" : "🛵 Delivery"}</button>)}
                </div>
              ) : <div className="text-sm font-semibold">{ful === "pickup" ? "🛍️ Pickup sa tindahan" : "🛵 Delivery"}</div>}
              <label className="grid gap-1 text-sm">Pangalan / Name<input className="input" required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="grid gap-1 text-sm">Mobile number<input className="input" required inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              {ful === "delivery" ? <label className="grid gap-1 text-sm">Address<textarea className="input" required minLength={5} maxLength={300} rows={2} autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label> : null}
              <label className="grid gap-1 text-sm">Paalala / Note (optional)<input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" value={hp} onChange={(e) => setHp(e.target.value)} />
              {formErr ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{formErr}</p> : null}
              <p className="text-xs text-slate-500">Ang pangalan at numero mo ay para lang sa tindahan para sa order na ito. / Your name and number go only to this store, for this order.</p>
              <div className="flex gap-2"><button type="button" className="btn" onClick={() => setStep("menu")}>← Bumalik</button><button className="btn-primary flex-1" disabled={busy || !lines.length}>{busy ? "Sending…" : `I-order / Place order · ${peso(subtotal + fee)}`}</button></div>
            </div>
          </form>
        )}
      </main>
      {step === "menu" && count ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3"><div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex-1 text-sm"><b>{count}</b> item{count > 1 ? "s" : ""} · <b>{peso(subtotal)}</b></div>
          <button className="btn-primary" onClick={() => setStep("checkout")}>Checkout →</button></div></div>
      ) : null}
    </div>
  );
}
