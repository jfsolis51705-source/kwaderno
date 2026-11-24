"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { NetworkMap as NetworkMapData } from "@/server/services/platform";

/**
 * Pilot network map. Three categories in fixed palette order (validated for CVD/contrast):
 *   1 blue   — pilot store now using KWADERNO
 *   2 orange — surveyed pilot store, not yet on the app
 *   3 aqua   — KWADERNO store with GPS but no pilot pin
 * Identity is never colour-alone: a labelled legend with counts, layer toggles, and a
 * text popup on every marker; the same data is in the Stores table.
 */
const CATS = [
  { key: "joined", label: "Pilot store on KWADERNO", color: "#2a78d6" },
  { key: "pending", label: "Surveyed, not yet on app", color: "#eb6834" },
  { key: "unpinned", label: "App store, no pilot pin", color: "#1baf7a" },
] as const;
type Cat = (typeof CATS)[number]["key"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function NetworkMap({ data, tileUrl, attribution }: { data: NetworkMapData; tileUrl: string; attribution: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState<Record<Cat, boolean>>({ joined: true, pending: true, unpinned: true });
  const [layer, setLayer] = useState("all");
  const layers = useMemo(() => ["all", ...new Set(data.pins.map((p) => p.layer.trim()))], [data.pins]);

  const points = useMemo(() => {
    const pins = data.pins
      .filter((p) => layer === "all" || p.layer.trim() === layer)
      .map((p) => ({
        cat: (p.app_store_id ? "joined" : "pending") as Cat,
        lat: p.latitude,
        lng: p.longitude,
        html: `<b>${esc(p.store_name)}</b><br>${esc([p.barangay, p.city].filter(Boolean).join(", ") || p.layer)}<br>${p.app_store_id ? `On KWADERNO as “${esc(p.app_store_name ?? "")}”` : "Not yet on KWADERNO"}${p.signed ? "<br>Signed in survey" : ""}${p.retention_status ? `<br>Survey: ${esc(p.retention_status)}` : ""}`,
      }));
    const stores = layer === "all" ? data.unpinnedStores.map((s) => ({ cat: "unpinned" as Cat, lat: s.latitude, lng: s.longitude, html: `<b>${esc(s.name)}</b><br>${esc(s.city ?? "")}<br>KWADERNO store (no pilot pin)` })) : [];
    return [...pins, ...stores];
  }, [data, layer]);
  const counts = useMemo(() => Object.fromEntries(CATS.map((c) => [c.key, points.filter((p) => p.cat === c.key).length])) as Record<Cat, number>, [points]);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);
      const shown = points.filter((p) => on[p.cat]);
      for (const p of shown) {
        const color = CATS.find((c) => c.key === p.cat)!.color;
        // 2px surface (white) ring keeps overlapping markers legible; r=7 → 14px dot, larger hit area via popup.
        L.circleMarker([p.lat, p.lng], { radius: 7, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(p.html).addTo(map);
      }
      const all = shown.length ? shown : points;
      if (all.length) map.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number])), { padding: [24, 24], maxZoom: 16 });
      else map.setView([14.65, 121.04], 12);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, on, tileUrl, attribution]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Survey area{" "}
          <select value={layer} onChange={(e) => setLayer(e.target.value)} className="bg-card ml-1 h-9 rounded-md border px-2 text-sm">
            {layers.map((l) => <option key={l} value={l}>{l === "all" ? "All areas" : l}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Legend and layer toggles" className="flex flex-wrap gap-2">
          {CATS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={on[c.key]}
              onClick={() => setOn({ ...on, [c.key]: !on[c.key] })}
              className={`bg-card flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on[c.key] ? "" : "opacity-50 line-through"}`}
            >
              <span className="size-3 rounded-full ring-2 ring-white" style={{ background: c.color }} aria-hidden />
              {c.label} <span className="num text-muted-foreground">{counts[c.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div ref={el} className="h-[65vh] min-h-80 w-full overflow-hidden rounded-xl border" role="application" aria-label="Map of pilot and KWADERNO stores" />
    </div>
  );
}
