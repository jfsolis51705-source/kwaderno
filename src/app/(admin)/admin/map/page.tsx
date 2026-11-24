import type { Metadata } from "next";
import { NetworkMap } from "@/components/admin/network-map";
import { requirePlatformAdmin } from "@/server/auth/current";
import { getNetworkMap } from "@/server/services/platform";

export const metadata: Metadata = { title: "Network map" };

export default async function AdminMapPage() {
  const user = await requirePlatformAdmin();
  const data = await getNetworkMap(user.id);
  // Tiles are configurable: OSM's public server is fine for a small admin team; use a paid/self-hosted tile provider at scale.
  const tileUrl = process.env.MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution = process.env.MAP_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network map</h1>
        <p className="text-muted-foreground text-sm">{data.pins.length} surveyed pilot stores and every KWADERNO store with a GPS location. Tap a dot for details.</p>
      </div>
      <NetworkMap data={data} tileUrl={tileUrl} attribution={attribution} />
    </div>
  );
}
