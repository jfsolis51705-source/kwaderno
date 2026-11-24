import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { ExpiryActions } from "@/components/expiry/expiry-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { EXPIRING_SOON_DAYS, listExpiries } from "@/server/services/expiry";
import { formatQty } from "@/lib/money";

export const metadata: Metadata = { title: "Expiry" };
const fmt = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ExpiryPage() {
  const { store } = await requireAppContext();
  const items = await listExpiries(store);
  const groups = [
    { key: "expired", title: "Expired — remove from shelf", items: items.filter((i) => i.days_left < 0) },
    { key: "soon", title: `Expiring within ${EXPIRING_SOON_DAYS} days`, items: items.filter((i) => i.days_left >= 0 && i.days_left <= EXPIRING_SOON_DAYS) },
    { key: "month", title: "Within 30 days", items: items.filter((i) => i.days_left > EXPIRING_SOON_DAYS && i.days_left <= 30) },
    { key: "later", title: "Later", items: items.filter((i) => i.days_left > 30) },
  ].filter((g) => g.items.length);
  return (
    <div className="space-y-4">
      <PageHeader title="Expiry" description="Track expiry dates with a product photo and a label photo. Sell first what expires first." actions={<Button asChild><Link href="/expiry/new"><Plus /> Track expiry</Link></Button>} />
      {items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No expiry dates tracked" description="Start with perishables: milk, bread, eggs, sauces." action={<Button asChild><Link href="/expiry/new">Track your first item</Link></Button>} />
      ) : (
        groups.map((g) => (
          <Card key={g.key}>
            <CardHeader><CardTitle>{g.title} <span className="text-muted-foreground font-normal">({g.items.length})</span></CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {g.items.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-protected photo */}
                    <img src={`/api/v1/stores/${store.storeId}/expiries/${e.id}/photo/label`} alt={`Expiry label of ${e.product_name}`} className="size-14 rounded-md border object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/products/${e.product_id}`} className="font-medium hover:underline">{e.product_name}</Link>
                      <p className="text-muted-foreground text-xs">
                        Expires {fmt.format(new Date(e.expiry_date + "T00:00:00Z"))}{e.quantity != null ? ` · ${formatQty(e.quantity)} ${e.unit} with this date` : ""} · {formatQty(e.stock)} in stock{e.note ? ` · ${e.note}` : ""}
                      </p>
                    </div>
                    <Badge variant={e.days_left < 0 ? "destructive" : e.days_left <= EXPIRING_SOON_DAYS ? "warning" : "secondary"}>
                      {e.days_left < 0 ? `${-e.days_left} day(s) ago` : e.days_left === 0 ? "Today" : `${e.days_left} day(s) left`}
                    </Badge>
                    <ExpiryActions storeId={store.storeId} id={e.id} name={e.product_name} unit={e.unit} quantity={e.quantity} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
