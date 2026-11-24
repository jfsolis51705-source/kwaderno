"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ProductPicker, type PickedProduct } from "@/components/products/product-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Photo = { file: File; url: string } | null;

/**
 * Strict sequence: 1 product → 2 photo of the product → 3 photo of the expiry label → 4 date.
 * Each step unlocks only after the previous one is done.
 */
export function ExpiryCapture({ storeId, initialProduct }: { storeId: string; initialProduct?: { id: string; name: string; unit: string } | null }) {
  const router = useRouter();
  const [product, setProduct] = useState<{ id: string; name: string; unit: string } | null>(initialProduct ?? null);
  const [productPhoto, setProductPhoto] = useState<Photo>(null);
  const [labelPhoto, setLabelPhoto] = useState<Photo>(null);
  const [date, setDate] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prodInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (productPhoto) URL.revokeObjectURL(productPhoto.url);
    if (labelPhoto) URL.revokeObjectURL(labelPhoto.url);
  }, [productPhoto, labelPhoto]);

  const pick = (set: (p: Photo) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Please take a photo (image)");
    if (f.size > 10 * 1024 * 1024) return toast.error("Photo is larger than 10 MB");
    set({ file: f, url: URL.createObjectURL(f) });
  };

  const step = !product ? 1 : !productPhoto ? 2 : !labelPhoto ? 3 : 4;

  async function save() {
    if (!product || !productPhoto || !labelPhoto || !date) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("productId", product.id);
    form.append("expiryDate", date);
    if (qty) form.append("quantity", qty);
    if (note) form.append("note", note);
    form.append("productPhoto", productPhoto.file);
    form.append("labelPhoto", labelPhoto.file);
    try {
      const res = await fetch(`/api/v1/stores/${storeId}/expiries`, { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save");
      toast.success(`Expiry saved for ${product.name}`);
      router.push("/expiry");
      router.refresh();
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you are online." : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-2xl gap-3">
      <Step current={step} n={1} title="Which product?">
        {product ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-accent px-3 py-2">
            <span className="font-medium">{product.name}</span>
            <Button variant="link" size="sm" onClick={() => { setProduct(null); setProductPhoto(null); setLabelPhoto(null); }}>Change</Button>
          </div>
        ) : (
          <ProductPicker storeId={storeId} placeholder="Search the product" onPick={(p: PickedProduct) => setProduct({ id: p.id, name: p.name, unit: p.unit })} />
        )}
      </Step>
      <Step current={step} n={2} title="Photo of the product">
        <p className="text-muted-foreground mb-3 text-sm">Show the whole item so it can be recognised later.</p>
        <PhotoStep photo={productPhoto} onTake={() => prodInput.current?.click()} label="Take product photo" onRetake={() => { setProductPhoto(null); setLabelPhoto(null); prodInput.current?.click(); }} />
      </Step>
      <Step current={step} n={3} title="Photo of the expiry date label">
        <p className="text-muted-foreground mb-3 text-sm">Close-up, so the printed date is readable.</p>
        <PhotoStep photo={labelPhoto} onTake={() => labelInput.current?.click()} label="Take label photo" onRetake={() => { setLabelPhoto(null); labelInput.current?.click(); }} />
      </Step>
      <Step current={step} n={4} title="Date and quantity">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Expiry date (as printed)<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">How many have this date? (optional)<Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder={product ? product.unit : ""} /></label>
          <label className="grid gap-1 text-sm sm:col-span-2">Note (optional)<Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. back shelf, top row" /></label>
        </div>
        {error && <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button className="mt-4 w-full" size="lg" disabled={busy || !date} onClick={save}>{busy && <Loader2 className="animate-spin" />} Save expiry</Button>
      </Step>
      <input ref={prodInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick(setProductPhoto)} />
      <input ref={labelInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick(setLabelPhoto)} />
    </div>
  );
}

function Step({ n, current, title, children }: { n: number; current: number; title: string; children: React.ReactNode }) {
  return (
    <Card className={cn(current < n && "pointer-events-none opacity-50")} aria-disabled={current < n}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className={cn("flex size-7 items-center justify-center rounded-full text-sm", current > n ? "bg-success text-white" : current === n ? "bg-primary text-primary-foreground" : "bg-muted")}>
            {current > n ? <Check className="size-4" /> : n}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PhotoStep({ photo, onTake, onRetake, label }: { photo: Photo; onTake: () => void; onRetake: () => void; label: string }) {
  return photo ? (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) */}
      <img src={photo.url} alt={label} className="size-24 rounded-lg border object-cover" />
      <Button type="button" variant="outline" onClick={onRetake}><RotateCcw /> Retake</Button>
    </div>
  ) : (
    <Button type="button" size="lg" onClick={onTake}><Camera /> {label}</Button>
  );
}
