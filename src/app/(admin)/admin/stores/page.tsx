import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/auth/current";
import { listPlatformStores } from "@/server/services/platform";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "Network stores" };
const d = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

export default async function AdminStoresPage() {
  const user = await requirePlatformAdmin();
  const stores = await listPlatformStores(user.id);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stores</h1>
        <p className="text-muted-foreground text-sm">{stores.length} store(s) on KWADERNO. Read-only: store data is changed only by the store&apos;s own members.</p>
      </div>
      <div className="bg-card rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead><TableHead>Owner</TableHead><TableHead>Location</TableHead><TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Customers</TableHead><TableHead className="text-right">Sales · 30d</TableHead><TableHead>Last sale</TableHead><TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-56">
                  <p className="truncate font-medium">{s.name}</p>
                  {s.pilot_store && <Badge variant="success" className="mt-1">Pilot: {s.pilot_store}</Badge>}
                </TableCell>
                <TableCell>{s.owner ?? "—"} <span className="text-muted-foreground text-xs">({s.members})</span></TableCell>
                <TableCell>
                  {[s.barangay, s.city].filter(Boolean).join(", ") || "—"}
                  {s.latitude != null && <a className="text-primary ml-1 inline-flex align-middle" href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer" aria-label="Open location"><MapPin className="size-3.5" /></a>}
                </TableCell>
                <TableCell className="num text-right">{s.products}</TableCell>
                <TableCell className="num text-right">{s.customers}</TableCell>
                <TableCell className="num text-right">{formatPeso(s.sales30Centavos)}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.last_sale ? d.format(new Date(s.last_sale)) : "—"}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{d.format(new Date(s.created_at))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
