"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, X } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api, ApiError } from "@/lib/api-client";
import { parsePesoToCentavos } from "@/lib/money";
import { MoneyInput } from "./money-input";

const UNITS = ["pc", "pack", "sachet", "bottle", "can", "box", "kg", "g", "L", "mL", "dozen", "tray", "bundle"];

export interface ProductFormValues {
  id?: string;
  name: string;
  brand: string | null;
  sku: string | null;
  category: string | null;
  unit: string;
  packagingDescription: string | null;
  purchaseCostCentavos: number;
  sellingPriceCentavos: number;
  reorderThreshold: string;
  packChildId: string | null;
  packQuantity: string | null;
  barcodes: string[];
}

/** Create or edit a product. Create mode also accepts barcodes and opening stock. */
export function ProductForm({
  storeId,
  categories,
  packCandidates,
  initial,
  initialBarcode,
}: {
  storeId: string;
  categories: { id: string; name: string }[];
  packCandidates: { id: string; name: string; unit: string }[];
  initial?: ProductFormValues;
  initialBarcode?: string;
}) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [barcodes, setBarcodes] = useState<string[]>(initial?.barcodes ?? (initialBarcode ? [initialBarcode] : []));
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [isPack, setIsPack] = useState(!!initial?.packChildId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const fe: Record<string, string> = {};
    const price = parsePesoToCentavos(s("sellingPrice"));
    const cost = s("purchaseCost") ? parsePesoToCentavos(s("purchaseCost")) : 0;
    if (!s("name")) fe.name = "Enter the product name";
    if (price == null) fe.sellingPriceCentavos = "Enter a valid price, e.g. 16.00";
    if (cost == null) fe.purchaseCostCentavos = "Enter a valid cost";
    if (isPack && (!s("packChildId") || !(Number(s("packQuantity")) > 0))) fe.packQuantity = "Choose the contained product and how many per pack";
    if (Object.keys(fe).length) return setErrors(fe);

    const body: Record<string, unknown> = {
      name: s("name"),
      brand: s("brand") || null,
      sku: s("sku") || null,
      categoryName: s("category") || null,
      unit: s("unit") || "pc",
      packagingDescription: s("packagingDescription") || null,
      sellingPriceCentavos: price,
      purchaseCostCentavos: cost,
      reorderThreshold: Number(s("reorderThreshold") || 0),
      packChildId: isPack ? s("packChildId") : null,
      packQuantity: isPack ? Number(s("packQuantity")) : null,
    };
    if (!editing) {
      const pending = barcodeDraft.trim();
      body.barcodes = pending && !barcodes.includes(pending) ? [...barcodes, pending] : barcodes;
      body.openingQuantity = Number(s("openingQuantity") || 0);
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const p = await api<{ id: string }>(editing ? `/api/v1/stores/${storeId}/products/${initial!.id}` : `/api/v1/stores/${storeId}/products`, {
        method: editing ? "PATCH" : "POST",
        json: body,
      });
      toast.success(editing ? "Product updated" : "Product added");
      router.push(`/products/${editing ? initial!.id : p.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError("Could not save the product");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Product details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="name" label="Product name" error={errors.name}>
                <Input id="name" name="name" defaultValue={initial?.name} placeholder="e.g. Lucky Me Pancit Canton Original 60g" aria-invalid={!!errors.name} autoFocus={!editing} />
              </Field>
            </div>
            <Field id="brand" label="Brand" error={errors.brand}>
              <Input id="brand" name="brand" defaultValue={initial?.brand ?? ""} />
            </Field>
            <Field id="category" label="Category" error={errors.categoryId} hint="Pick or type a new one">
              <Input id="category" name="category" list="category-list" defaultValue={initial?.category ?? ""} autoComplete="off" />
              <datalist id="category-list">
                {categories.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>
            <Field id="unit" label="Counted in" error={errors.unit} hint="The unit you sell and count">
              <Input id="unit" name="unit" list="unit-list" defaultValue={initial?.unit ?? "pc"} autoComplete="off" />
              <datalist id="unit-list">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <Field id="sku" label="SKU / code (optional)" error={errors.sku}>
              <Input id="sku" name="sku" defaultValue={initial?.sku ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field id="packagingDescription" label="Packaging (optional)" error={errors.packagingDescription} hint="e.g. 60g pouch, 1L bottle">
                <Input id="packagingDescription" name="packagingDescription" defaultValue={initial?.packagingDescription ?? ""} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Price</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field id="sellingPrice" label="Selling price" error={errors.sellingPriceCentavos}>
              <MoneyInput id="sellingPrice" name="sellingPrice" defaultCentavos={initial?.sellingPriceCentavos} invalid={!!errors.sellingPriceCentavos} />
            </Field>
            <Field id="purchaseCost" label="Cost (puhunan)" error={errors.purchaseCostCentavos}>
              <MoneyInput id="purchaseCost" name="purchaseCost" defaultCentavos={initial?.purchaseCostCentavos} invalid={!!errors.purchaseCostCentavos} />
            </Field>
            <Field id="reorderThreshold" label="Low-stock alert at" error={errors.reorderThreshold}>
              <Input id="reorderThreshold" name="reorderThreshold" inputMode="decimal" className="num" defaultValue={initial ? Number(initial.reorderThreshold) : 5} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" /> Packaging variant
            </CardTitle>
            <CardDescription>For a box/pack of another product you also sell individually. Each keeps its own stock.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={isPack} onChange={(e) => setIsPack(e.target.checked)} className="accent-primary size-5" />
              This product is a pack containing another product
            </label>
            {isPack && (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field id="packChildId" label="Contains" error={errors.packChildId}>
                  <NativeSelect id="packChildId" name="packChildId" defaultValue={initial?.packChildId ?? ""}>
                    <option value="">Choose product…</option>
                    {packCandidates.filter((c) => c.id !== initial?.id).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.unit})</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="packQuantity" label="How many per pack" error={errors.packQuantity}>
                  <Input id="packQuantity" name="packQuantity" inputMode="decimal" className="num" defaultValue={initial?.packQuantity ? Number(initial.packQuantity) : ""} />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {!editing && (
          <Card>
            <CardHeader>
              <CardTitle>Barcodes</CardTitle>
              <CardDescription>Optional. Add every barcode printed on this item.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {barcodes.map((b) => (
                  <Badge key={b} variant="secondary" className="num gap-1 py-1 text-sm">
                    {b}
                    <button type="button" aria-label={`Remove ${b}`} onClick={() => setBarcodes(barcodes.filter((x) => x !== b))}>
                      <X className="size-3.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={barcodeDraft}
                  onChange={(e) => setBarcodeDraft(e.target.value)}
                  inputMode="numeric"
                  placeholder="Type or scan"
                  aria-label="Barcode"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = barcodeDraft.trim();
                      if (v.length >= 3 && !barcodes.includes(v)) setBarcodes([...barcodes, v]);
                      setBarcodeDraft("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    const v = barcodeDraft.trim();
                    if (v.length >= 3 && !barcodes.includes(v)) setBarcodes([...barcodes, v]);
                    setBarcodeDraft("");
                  }}
                >
                  Add
                </Button>
              </div>
              {errors.barcode && <p className="text-destructive text-sm">{errors.barcode}</p>}
            </CardContent>
          </Card>
        )}
        {!editing && (
          <Card>
            <CardHeader>
              <CardTitle>Current stock</CardTitle>
              <CardDescription>How many do you have right now? Recorded as opening stock.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field id="openingQuantity" label="Quantity on hand" error={errors.openingQuantity}>
                <Input id="openingQuantity" name="openingQuantity" inputMode="decimal" className="num" defaultValue="0" />
              </Field>
            </CardContent>
          </Card>
        )}
        <Button type="submit" size="xl" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {editing ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}
