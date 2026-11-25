import { useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { api, ApiError } from "../../lib/api";
import { hasBarcodeDetector, startScanner } from "../../lib/barcode";
import { ISSUE_TEXT, peso, when } from "../../lib/format";
import type { Capture, CaptureItem, CaptureKind, Checkins, Product } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty, StockChip } from "../../components/ui";

const KINDS: [CaptureKind, string, string][] = [
  ["shelf", "Shelf photo", "Counts what is on the shelf — sets stock to the counted amount."],
  ["receipt", "Purchase receipt", "Wholesale receipt — adds the items to stock and updates costs."],
  ["ledger", "Handwritten ledger", "Your sales listahan — takes the sold items out of stock."],
];
type Tab = "photo" | "barcode" | "manual";

export default function CaptureHub() {
  const [tab, setTab] = useState<Tab>("photo");
  return (
    <div className="grid gap-4">
      <div><h1 className="text-xl font-bold">Capture</h1><p className="text-sm text-slate-500">Three ways to update your stock.</p></div>
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200 p-1">
        {([["photo", "📷 Photo"], ["barcode", "▥ Barcode"], ["manual", "✎ Manual"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-sm font-semibold ${tab === k ? "bg-white shadow text-slate-900" : "text-slate-600"}`}>{l}</button>
        ))}
      </div>
      {tab === "photo" ? <PhotoCapture /> : tab === "barcode" ? <BarcodeCapture /> : <ManualCapture />}
    </div>
  );
}

// ---------------- Photo: shelf / receipt / ledger ----------------
function PhotoCapture() {
  const { submitCapture, toast, storeId, online, visionProvider } = useApp();
  const [kind, setKind] = useState<CaptureKind>("shelf");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Capture | null>(null);
  const [pending, setPending] = useState<Capture[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadPending = () => { if (storeId && online) api.captures({ storeId, status: "pending_review" }).then(setPending).catch(() => {}); };
  useEffect(loadPending, [storeId, online, review]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | null) => { setFile(f); setReview(null); setPreview(f ? URL.createObjectURL(f) : null); };
  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await submitCapture(kind, file, file.name || "photo.jpg");
      if (r === "queued") { toast("Offline — photo saved and will be analysed when you're back online", "warn"); pick(null); }
      else { setReview(r); if (r.duplicate_of) toast("Duplicate photo — already submitted before", "err"); }
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const [checkins, setCheckins] = useState<Checkins | null>(null);
  useEffect(() => { if (storeId && online) api.checkins(storeId).then(setCheckins).catch(() => {}); }, [storeId, online, review]);
  if (review) return <ReviewPanel capture={review} onDone={() => { pick(null); loadPending(); }} />;
  const t = checkins?.today;
  return (
    <div className="grid gap-4">
      {checkins ? (
        <div className="card grid gap-2 border-brand-100 bg-brand-50" data-testid="checkin-card">
          <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Today's check-in</h2><span className="chip bg-white text-brand-700">🔥 {checkins.streak}-day streak</span></div>
          <p className="text-xs text-slate-600">Keep your notebook and shelves as they are — just take 2 photos a day: your sales ledger page and your shelves. +{checkins.bonus.per_day} points when both are saved, +{checkins.bonus.every_7_days} every 7 days in a row.</p>
          <div className="grid grid-cols-2 gap-2">
            {([["ledger", "📒 Ledger page"], ["shelf", "🗄️ Shelves"]] as [CaptureKind, string][]).map(([k, l]) => (
              <button key={k} className={`rounded-lg border p-2.5 text-left text-sm font-semibold ${t?.[k as "ledger" | "shelf"] ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white"}`} onClick={() => { setKind(k); inputRef.current?.click(); }}>
                {t?.[k as "ledger" | "shelf"] ? "✓ " : "○ "}{l}<div className="text-xs font-normal text-slate-500">{t?.[k as "ledger" | "shelf"] ? "Done today" : "Tap to take photo"}</div></button>))}
          </div>
          <div className="flex gap-1" aria-label="Last 14 days">{checkins.days.slice(-14).map((d) => <span key={d.date} title={d.date} className={`h-2 flex-1 rounded ${d.complete ? "bg-brand-500" : d.ledger || d.shelf ? "bg-brand-100" : "bg-slate-200"}`} />)}</div>
        </div>) : null}
      <div className="card grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map(([k, label, hint]) => (
            <label key={k} className={`cursor-pointer rounded-lg border p-3 ${kind === k ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
              <input type="radio" name="kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              <div className="text-sm font-semibold">{label}</div><div className="mt-0.5 text-xs text-slate-500">{hint}</div>
            </label>
          ))}
        </div>
        <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:border-brand-500">
          {preview ? <img src={preview} alt="Selected" className="max-h-72 rounded-lg object-contain" /> : <><div className="text-3xl">📷</div><div className="mt-1 text-sm font-semibold">Take or choose a photo</div><div className="text-xs text-slate-500">Fill the frame, good light, hold steady</div></>}
          <input ref={inputRef} data-testid="photo-input" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn-primary py-3" disabled={!file || busy} onClick={analyze}>{busy ? "Analysing…" : online ? "Analyse photo" : "Save photo (offline)"}</button>
        <p className="text-xs text-slate-500">Vision: {visionProvider}. Duplicate and blurry photos are flagged before any points are given.</p>
      </div>
      <div className="card">
        <h2 className="mb-2 font-semibold">Waiting for your review</h2>
        {pending.length ? <ul className="divide-y divide-slate-100">{pending.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <img src={c.image_url} alt="" className="h-12 w-16 rounded object-cover" />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold capitalize">{c.kind} · {c.items.length} item(s)</div><div className="text-xs text-slate-500">{when(c.created_at)}{c.quality_ok ? "" : " · low quality"}</div></div>
            <button className="btn btn-sm" onClick={() => setReview(c)}>Review</button>
          </li>))}</ul> : <Empty>Nothing to review.</Empty>}
      </div>
    </div>
  );
}

function ReviewPanel({ capture, onDone }: { capture: Capture; onDone: () => void }) {
  const { toast, refreshProducts } = useApp();
  const [items, setItems] = useState<CaptureItem[]>(capture.items.map((i) => ({ ...i })));
  const [busy, setBusy] = useState(false);
  const dup = capture.duplicate_of != null;
  const set = (i: number, k: keyof CaptureItem, v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: k === "qty" ? Math.max(0, Math.round(Number(v) || 0)) : k === "unit_price" ? Math.max(0, Number(v) || 0) : v } : x)));
  const confirm = async () => {
    const clean = items.filter((i) => i.sku.trim()).map((i) => ({ ...i, sku: i.sku.trim().toUpperCase() }));
    setBusy(true);
    try {
      const c = await api.confirmCapture(capture.id, clean);
      const bonus = c.checkin_bonus ? `, +${c.checkin_bonus} check-in bonus` : "";
      toast(c.points_awarded ? `Saved — stock updated, +${c.points_awarded} points${bonus}` : `Saved — stock updated (no points: photo quality too low)${bonus}`, c.points_awarded ? "ok" : "warn");
      await refreshProducts(); onDone();
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };
  const reject = async () => { try { await api.rejectCapture(capture.id, "Discarded by merchant"); toast("Discarded"); onDone(); } catch (e) { toast((e as Error).message, "err"); } };
  return (
    <div className="grid gap-4">
      <div className="card grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <img src={capture.image_url} alt="Submitted" className="max-h-80 w-full rounded-lg bg-slate-100 object-contain" />
        <div className="grid content-start gap-2">
          <h2 className="text-lg font-bold capitalize">{capture.kind} capture #{capture.id}</h2>
          {dup ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><b>Duplicate photo.</b> This image matches capture #{capture.duplicate_of}. It was rejected — no stock change, no points.</div> : null}
          {!dup && !capture.quality_ok ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Low quality:</b> {capture.quality_issues.map((q) => ISSUE_TEXT[q] ?? q).join(", ")}. You can still save the items, but no points are given. Retake for points.</div> : null}
          <div className="text-xs text-slate-500">{capture.width}×{capture.height}px · {(capture.size_bytes / 1024).toFixed(0)} KB · sharpness {capture.blur_score.toFixed(0)} · {capture.provider}</div>
          <div className="text-xs text-slate-500">Check every line — the AI can misread. Low-confidence lines are highlighted.</div>
        </div>
      </div>
      {!dup ? (
        <div className="card">
          <div className="hidden grid-cols-[1.1fr_2fr_1.2fr_80px_100px_48px_36px] gap-2 border-b border-slate-200 pb-2 text-xs font-medium text-slate-500 md:grid">
            {["SKU", "Name / brand", "Variant", "Qty", "Unit price", "Conf.", ""].map((h) => <span key={h}>{h}</span>)}</div>
          <ul className="grid gap-2 md:gap-0">{items.map((it, i) => (
            <li key={i} className={`grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-[1.1fr_2fr_1.2fr_80px_100px_48px_36px] md:items-center md:rounded-none md:border-0 md:border-b md:border-slate-100 md:px-0 md:py-2 ${it.confidence < 0.7 ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
              <label className="col-span-2 md:col-span-1"><span className="label md:hidden">SKU</span><input aria-label="SKU" className="input py-1 font-mono text-xs" value={it.sku} onChange={(e) => set(i, "sku", e.target.value)} /></label>
              <div className="col-span-2 grid gap-1 md:col-span-1"><span className="label md:hidden">Name / brand</span><input aria-label="Name" className="input py-1" value={it.name ?? ""} onChange={(e) => set(i, "name", e.target.value)} /><input aria-label="Brand" className="input py-1 text-xs" value={it.brand ?? ""} onChange={(e) => set(i, "brand", e.target.value)} /></div>
              <label className="col-span-2 md:col-span-1"><span className="label md:hidden">Variant</span><input aria-label="Variant" className="input py-1" value={it.variant ?? ""} onChange={(e) => set(i, "variant", e.target.value)} /></label>
              <label><span className="label md:hidden">Qty</span><input aria-label="Quantity" type="number" min={0} className="input py-1 text-right" value={it.qty} onChange={(e) => set(i, "qty", e.target.value)} /></label>
              <label><span className="label md:hidden">Unit price (₱)</span><input aria-label="Unit price" type="number" min={0} step="0.25" className="input py-1 text-right" value={it.unit_price} onChange={(e) => set(i, "unit_price", e.target.value)} /></label>
              <span className="text-xs tabular-nums text-slate-600"><span className="md:hidden">AI confidence </span>{Math.round(it.confidence * 100)}%</span>
              <button className="btn-danger btn-sm justify-self-end" aria-label="Remove line" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>×</button>
            </li>))}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => setItems((xs) => [...xs, { sku: "", name: "", brand: "", variant: "", qty: 1, unit_price: 0, confidence: 1 }])}>+ Add line</button>
            <span className="flex-1" />
            <button className="btn-danger" onClick={reject}>Discard</button>
            <button className="btn-primary" disabled={busy} onClick={confirm}>{busy ? "Saving…" : "Confirm & update stock"}</button>
          </div>
        </div>
      ) : <button className="btn" onClick={onDone}>Take another photo</button>}
    </div>
  );
}

// ---------------- Barcode ----------------
function BarcodeCapture() {
  const { products, storeId, adjustStock, toast, online } = useApp();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Product | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<() => void>();
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = async (raw: string) => {
    const c = raw.trim(); if (!c || !storeId) return;
    setUnknown(null);
    const local = products.find((p) => p.barcode === c || p.sku === c.toUpperCase());
    if (local) { setFound(local); return; }
    if (online) { try { setFound(await api.lookup(storeId, c)); return; } catch (e) { if (!(e instanceof ApiError)) toast((e as Error).message, "err"); } }
    setFound(null); setUnknown(c);
  };
  const bump = async (delta: number) => {
    if (!found) return;
    try { const p = await adjustStock({ sku: found.sku }, delta, "barcode"); if (p) { setFound(p); toast(`${p.name}: ${p.qty_on_hand} on hand${online ? "" : " (queued)"}`); } }
    catch (e) { toast((e as Error).message, "err"); }
  };
  useEffect(() => () => stopRef.current?.(), []);
  const toggleCamera = async () => {
    if (camera) { stopRef.current?.(); setCamera(false); return; }
    try { setCamera(true); stopRef.current = await startScanner(videoRef.current!, (v) => { setCode(v); lookup(v); }); }
    catch { setCamera(false); toast("Camera not available — type the code or use a USB/Bluetooth scanner", "warn"); }
  };
  return (
    <div className="grid gap-4">
      <div className="card grid gap-3">
        {hasBarcodeDetector() ? <button className="btn" onClick={toggleCamera}>{camera ? "Stop camera" : "📷 Scan with camera"}</button> : <p className="text-xs text-slate-500">Camera scanning needs Chrome/Edge/Android. Type the code, or use a barcode scanner (it types and presses Enter).</p>}
        <div className={camera ? "relative overflow-hidden rounded-lg bg-black" : "hidden"}>
          <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
          {/* scan rectangle: corner brackets, a dimmed outside and a moving line */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <div className="scan-frame relative aspect-[2.2/1] w-[78%] max-w-sm rounded-xl" style={{ boxShadow: "0 0 0 100vmax rgb(0 0 0 / .5)" }}>
              <i className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-xl border-l-4 border-t-4 border-white" /><i className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-xl border-r-4 border-t-4 border-white" />
              <i className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-xl border-b-4 border-l-4 border-white" /><i className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-xl border-b-4 border-r-4 border-white" />
              <b className="scan-line absolute inset-x-[6%] top-1/2 h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444]" />
            </div>
          </div>
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-white drop-shadow">Fit the barcode inside the box</p>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
          <input ref={inputRef} autoFocus aria-label="Barcode or SKU" inputMode="numeric" className="input" placeholder="Scan or type barcode / SKU, then Enter" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-primary" type="submit">Find</button>
        </form>
      </div>
      {found ? (
        <div className="card grid gap-3" data-testid="scan-result">
          <div className="flex items-start gap-3">
            {found.thumbnail_url ? <img src={found.thumbnail_url} alt="" className="h-14 w-14 rounded object-cover" /> : <div className="grid h-14 w-14 place-items-center rounded bg-slate-100 text-xs font-bold text-slate-500">{found.brand?.slice(0, 3) ?? "SKU"}</div>}
            <div className="min-w-0 flex-1"><div className="font-semibold">{found.name}</div><div className="text-xs text-slate-500">{found.sku} · {found.barcode ?? "no barcode"} · {peso(found.price)}</div></div>
            <StockChip status={found.status} qty={found.qty_on_hand} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[-1, 1, 6, 12].map((d) => <button key={d} className={d < 0 ? "btn-danger py-3" : "btn py-3"} onClick={() => bump(d)}>{d > 0 ? `+${d}` : d}</button>)}
          </div>
          <button className="btn btn-sm" onClick={() => { setFound(null); setCode(""); inputRef.current?.focus(); }}>Next item</button>
        </div>
      ) : unknown ? <QuickAdd barcode={unknown} onDone={() => { setUnknown(null); lookup(unknown); }} /> : null}
    </div>
  );
}

// ---------------- Manual ----------------
function ManualCapture() {
  const { products, adjustStock, toast, online } = useApp();
  const [q, setQ] = useState("");
  const [delta, setDelta] = useState<Record<number, string>>({});
  const list = useMemo(() => products.filter((p) => !q || `${p.name} ${p.sku} ${p.brand ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30), [products, q]);
  const apply = async (p: Product, d: number) => {
    if (!d) return;
    try { const np = await adjustStock({ sku: p.sku }, d, "manual"); if (np) toast(`${np.name}: ${np.qty_on_hand} on hand${online ? "" : " (queued)"}`); setDelta((x) => ({ ...x, [p.id]: "" })); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="grid gap-4">
      <div className="card grid gap-3">
        <h2 className="font-semibold">Quick stock adjustment</h2>
        <input className="input" aria-label="Search products" placeholder="Search product, SKU or brand" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="divide-y divide-slate-100">{list.map((p) => (
          <li key={p.sku} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="text-xs text-slate-500">{p.sku}</div></div>
            <StockChip status={p.status} qty={p.qty_on_hand} />
            <input aria-label={`Change for ${p.name}`} type="number" className="input w-20 py-1 text-right" placeholder="±" value={delta[p.id] ?? ""} onChange={(e) => setDelta((x) => ({ ...x, [p.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") apply(p, Math.round(Number(delta[p.id]) || 0)); }} />
            <button className="btn btn-sm" onClick={() => apply(p, Math.round(Number(delta[p.id]) || 0))}>Apply</button>
          </li>))}</ul>
      </div>
      <QuickAdd />
    </div>
  );
}

function QuickAdd({ barcode, onDone }: { barcode?: string; onDone?: () => void }) {
  const { saveProduct, toast, online } = useApp();
  const empty = { sku: "", name: "", brand: "", barcode: barcode ?? "", price: "", qty: "", reorder: "5" };
  const [f, setF] = useState(empty);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sku = (f.sku || f.barcode || f.name).trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    if (!f.name.trim() || !sku) return toast("Enter at least a name", "warn");
    try {
      await saveProduct({ sku, name: f.name.trim(), brand: f.brand.trim() || undefined, barcode: f.barcode.trim() || undefined, price: Number(f.price) || 0, qty_on_hand: Math.max(0, Math.round(Number(f.qty) || 0)), reorder_level: Math.max(0, Math.round(Number(f.reorder) || 0)) });
      toast(`Added ${f.name}${online ? "" : " (queued)"}`); setF(empty); onDone?.();
    } catch (err) { toast((err as Error).message, "err"); }
  };
  const field = (k: keyof typeof f, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label><span className="label">{label}</span><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>
  );
  return (
    <form className="card grid gap-3" onSubmit={submit} aria-label="Quick add product">
      <h2 className="font-semibold">{barcode ? `New barcode ${barcode} — add it` : "Quick add product"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Product name", { required: true, placeholder: "e.g. Lucky Me Pancit Canton 60g" })}
        {field("brand", "Brand")}
        {field("sku", "SKU (optional)", { placeholder: "auto from barcode/name" })}
        {field("barcode", "Barcode", { inputMode: "numeric" })}
        {field("price", "Selling price (₱)", { inputMode: "decimal" })}
        {field("qty", "Stock now", { inputMode: "numeric" })}
        {field("reorder", "Low-stock alert at", { inputMode: "numeric" })}
      </div>
      <button className="btn-primary" type="submit">Add product</button>
    </form>
  );
}
