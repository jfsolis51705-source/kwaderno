import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Boxes, HandCoins, MapPin, ReceiptText, Store, Users, Wallet } from "lucide-react";
import { SalesTrendChart } from "@/components/admin/sales-trend-chart";
import { DashboardMetricCard } from "@/components/app/dashboard-metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/auth/current";
import { getPlatformOverview } from "@/server/services/platform";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "KELSON network" };
const TYPE: Record<string, string> = { sari_sari: "Sari-sari", grocery: "Grocery", restaurant: "Restaurant", online_selling: "Online selling", auto_moto: "Auto / moto", other: "Other" };

export default async function AdminOverviewPage() {
  const user = await requirePlatformAdmin();
  const o = await getPlatformOverview(user.id);
  const conv = o.pilot.pins ? Math.round((o.pilot.claimed / o.pilot.pins) * 100) : 0;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network overview</h1>
        <p className="text-muted-foreground text-sm">All KWADERNO stores, live from the ledgers. Days in Philippine time.</p>
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key figures">
        <DashboardMetricCard label="Sales today" value={formatPeso(o.sales.todayCentavos)} hint={`${o.sales.todayCount} transactions`} icon={Wallet} />
        <DashboardMetricCard label="Sales · 30 days" value={formatPeso(o.sales.d30Centavos)} hint={`${o.sales.d30Count} transactions`} icon={Activity} />
        <DashboardMetricCard label="Stores" value={String(o.totals.stores)} hint={`${o.totals.activeStores7d} sold in the last 7 days`} icon={Store} href="/admin/stores" />
        <DashboardMetricCard label="Pilot stores on app" value={`${o.pilot.claimed} / ${o.pilot.pins}`} hint={`${conv}% of surveyed pins`} icon={MapPin} href="/admin/map" />
        <DashboardMetricCard label="Utang outstanding" value={formatPeso(o.totals.utangCentavos)} hint="Across all stores" icon={HandCoins} />
        <DashboardMetricCard label="Inventory value" value={formatPeso(o.totals.inventoryValueCentavos)} hint={`${o.totals.products} active products`} icon={Boxes} />
        <DashboardMetricCard label="Receipts confirmed" value={String(o.totals.receiptsConfirmed)} hint="AI-assisted stock-ins" icon={ReceiptText} />
        <DashboardMetricCard label="Users" value={String(o.totals.users)} hint={`${o.totals.offlineOpsSynced} offline items synced`} icon={Users} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Daily sales — all stores</CardTitle>
          <CardDescription>Last 30 days · GCash {formatPeso(o.sales.gcash30Centavos)} · utang {formatPeso(o.sales.credit30Centavos)}</CardDescription>
        </CardHeader>
        <CardContent><SalesTrendChart data={o.trend} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top stores · 30 days</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Store</TableHead><TableHead>City</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Txns</TableHead></TableRow></TableHeader>
              <TableBody>
                {o.topStores.map((s) => (
                  <TableRow key={s.id}><TableCell className="max-w-48 truncate font-medium">{s.name}</TableCell><TableCell>{s.city ?? "—"}</TableCell><TableCell className="num text-right">{formatPeso(s.sales30Centavos)}</TableCell><TableCell className="num text-right">{s.sales30Count}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By city · 30 days</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>City</TableHead><TableHead className="text-right">Stores</TableHead><TableHead className="text-right">Sales</TableHead></TableRow></TableHeader>
              <TableBody>
                {o.byCity.map((c) => (
                  <TableRow key={c.city}><TableCell>{c.city}</TableCell><TableCell className="num text-right">{c.stores}</TableCell><TableCell className="num text-right">{formatPeso(c.sales30Centavos)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-muted-foreground mt-3 text-xs">Business types: {o.byType.map((t) => `${TYPE[t.type] ?? t.type} ${t.stores}`).join(" · ")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Pilot funnel</CardTitle><CardDescription>Field-surveyed stores (map pins) → using KWADERNO</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["Surveyed pins", o.pilot.pins], ["Signed in survey", o.pilot.signed], ["Retained in survey", o.pilot.retained], ["Now on KWADERNO", o.pilot.claimed]].map(([l, v]) => (
            <div key={l as string}><p className="num text-2xl font-semibold">{v}</p><p className="text-muted-foreground text-xs">{l}</p></div>
          ))}
          <p className="text-muted-foreground col-span-full text-xs"><Link className="text-primary underline" href="/admin/map">Open the network map</Link> to see which pins have joined.</p>
        </CardContent>
      </Card>
    </div>
  );
}
