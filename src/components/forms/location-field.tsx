"use client";
import { useState } from "react";
import { Crosshair, ExternalLink, Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Store GPS capture. Uses the phone's location (the merchant should be at the store).
 * Renders hidden `latitude`/`longitude` inputs only when a position is set.
 */
export function LocationField({
  value,
  onChange,
  disabled,
}: {
  value: LatLng | null;
  onChange: (v: LatLng | null) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) {
      setError("This browser cannot share location.");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setAccuracy(Math.round(pos.coords.accuracy));
        onChange({ latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) });
      },
      (err) => {
        setBusy(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was blocked. Allow it in your browser settings and try again."
            : "Could not get your location. Go outside or near a window and try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="bg-muted flex flex-wrap items-center gap-2 rounded-lg p-3 text-sm">
          <MapPin className="text-primary size-4" />
          <span className="num">{value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}</span>
          {accuracy != null && <span className="text-muted-foreground text-xs">±{accuracy} m</span>}
          <a
            className="text-primary ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
            href={`https://www.google.com/maps?q=${value.latitude},${value.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            View on map <ExternalLink className="size-3" />
          </a>
          {!disabled && (
            <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Clear location" onClick={() => onChange(null)}>
              <X />
            </Button>
          )}
          <input type="hidden" name="latitude" value={value.latitude} />
          <input type="hidden" name="longitude" value={value.longitude} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Not set. Stand inside your store, then tap the button.</p>
      )}
      {!disabled && (
        <Button type="button" variant="outline" onClick={locate} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Crosshair />} {value ? "Update to my current location" : "Use my current location"}
        </Button>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
