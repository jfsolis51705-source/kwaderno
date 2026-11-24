"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { LocationField, type LatLng } from "@/components/forms/location-field";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api-client";

type Profile = {
  name: string; ownerName: string; phone: string; addressLine: string; barangay: string; city: string; province: string; allowNegativeStock: boolean;
  location: LatLng | null; pilotStoreName: string | null;
};

export function StoreProfileForm({ storeId, initial, canEdit, isOwner }: { storeId: string; initial: Profile; canEdit: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [location, setLocation] = useState<LatLng | null>(initial.location);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(["name", "ownerName", "phone", "addressLine", "barangay", "city", "province"].map((k) => [k, fd.get(k)]));
    if (isOwner) body.allowNegativeStock = fd.get("allowNegativeStock") === "on";
    const prev = initial.location;
    if (location?.latitude !== prev?.latitude || location?.longitude !== prev?.longitude) {
      body.latitude = location?.latitude ?? null;
      body.longitude = location?.longitude ?? null;
    }
    setBusy(true);
    try {
      const saved = await api<{ pilotMatch: string | null }>(`/api/v1/stores/${storeId}`, { method: "PATCH", json: body });
      setErrors({});
      toast.success(saved.pilotMatch ? `Saved. Matched to pilot store "${saved.pilotMatch}".` : "Store profile saved");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fields: [keyof Profile, string, string?][] = [
    ["name", "Store name"],
    ["ownerName", "Owner name"],
    ["phone", "Store mobile", "tel"],
    ["addressLine", "Street / landmark"],
    ["barangay", "Barangay"],
    ["city", "City / municipality"],
    ["province", "Province"],
  ];
  return (
    <Card>
      <form onSubmit={onSubmit} className="contents">
        <CardHeader>
          <CardTitle>Store profile</CardTitle>
          {!canEdit && <CardDescription>Only owners and managers can edit these details.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label, type]) => (
            <Field key={k} id={k} label={label} error={errors[k]}>
              <Input id={k} name={k} type={type ?? "text"} defaultValue={initial[k] as string} disabled={!canEdit} aria-invalid={!!errors[k]} />
            </Field>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Store location</p>
              {initial.pilotStoreName && <Badge variant="success">KELSON pilot store: {initial.pilotStoreName}</Badge>}
            </div>
            <LocationField value={location} onChange={setLocation} disabled={!canEdit} />
            {errors.latitude && <p className="text-destructive text-sm">{errors.latitude}</p>}
          </div>
          {isOwner && (
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
              <input type="checkbox" name="allowNegativeStock" defaultChecked={initial.allowNegativeStock} className="accent-primary mt-0.5 size-5" />
              <span>
                <span className="font-medium">Allow selling when recorded stock is zero</span>
                <span className="text-muted-foreground block">
                  Off (recommended): the sale is blocked so you can fix the count first. On: stock goes negative and is flagged for review.
                </span>
              </span>
            </label>
          )}
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
