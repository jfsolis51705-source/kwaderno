"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bike, Loader2, ShoppingBasket, Store, Truck, UtensilsCrossed, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { LocationField, type LatLng } from "@/components/forms/location-field";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { storeSchema } from "@/lib/validation";

const TYPES = [
  { value: "sari_sari", label: "Sari-sari store", icon: Store, ready: true },
  { value: "grocery", label: "Grocery / minimart", icon: ShoppingBasket, ready: true },
  { value: "restaurant", label: "Restaurant / karinderya", icon: UtensilsCrossed, ready: false },
  { value: "online_selling", label: "Online selling", icon: Truck, ready: false },
  { value: "auto_moto", label: "Auto / motor shop", icon: Bike, ready: false },
  { value: "other", label: "Other business", icon: Sparkles, ready: false },
] as const;

export function StoreSetupForm({ ownerName }: { ownerName: string }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("sari_sari");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<LatLng | null>(null);
  const selected = TYPES.find((t) => t.value === type)!;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { latitude: _lat, longitude: _lng, ...fields } = Object.fromEntries(new FormData(e.currentTarget));
    void _lat;
    void _lng;
    const values = { ...fields, businessType: type, ...(location ?? {}) };
    const parsed = storeSchema.safeParse(values);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    setBusy(true);
    setFormError(null);
    try {
      const created = await api<{ pilotMatch: string | null }>("/api/v1/stores", { method: "POST", json: parsed.data });
      if (created.pilotMatch) toast.success(`Welcome! We matched you to the pilot store "${created.pilotMatch}".`);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the store");
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} method="post" action="/onboarding" className="space-y-6" noValidate>
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium">What kind of business?</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TYPES.map((t) => (
            <button
              type="button"
              key={t.value}
              onClick={() => setType(t.value)}
              aria-pressed={type === t.value}
              className={cn(
                "bg-card flex min-h-24 flex-col items-start justify-between gap-2 rounded-xl border p-3 text-left text-sm font-medium transition-all",
                type === t.value ? "border-primary ring-primary/30 ring-[3px]" : "hover:border-primary/40",
              )}
            >
              <t.icon className={cn("size-6", type === t.value ? "text-primary" : "text-muted-foreground")} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {!selected.ready && (
          <Alert variant="warning">
            <AlertDescription>
              KWADERNO is tuned for sari-sari and grocery stores right now. You can still use it for a {selected.label.toLowerCase()} — specialised
              tools for this business type are planned.
            </AlertDescription>
          </Alert>
        )}
      </fieldset>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {formError && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="sm:col-span-2">
            <Field id="name" label="Store name" error={errors.name}>
              <Input id="name" name="name" placeholder="e.g. Aling Nena's Sari-sari" aria-invalid={!!errors.name} autoFocus />
            </Field>
          </div>
          <Field id="ownerName" label="Owner name" error={errors.ownerName}>
            <Input id="ownerName" name="ownerName" defaultValue={ownerName} />
          </Field>
          <Field id="phone" label="Store mobile (optional)" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="09171234567" aria-invalid={!!errors.phone} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="addressLine" label="Street / landmark (optional)" error={errors.addressLine}>
              <Input id="addressLine" name="addressLine" />
            </Field>
          </div>
          <Field id="barangay" label="Barangay" error={errors.barangay}>
            <Input id="barangay" name="barangay" />
          </Field>
          <Field id="city" label="City / municipality" error={errors.city}>
            <Input id="city" name="city" />
          </Field>
          <Field id="province" label="Province" error={errors.province}>
            <Input id="province" name="province" />
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">Store location (recommended)</p>
            <p className="text-muted-foreground text-xs">Helps suppliers find you for deliveries. Your exact location is never shown to other merchants.</p>
            <LocationField value={location} onChange={setLocation} />
            {errors.latitude && <p className="text-destructive text-sm">{errors.latitude}</p>}
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="xl" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} Create my store
      </Button>
    </form>
  );
}
