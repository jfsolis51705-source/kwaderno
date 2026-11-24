import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Receipt, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { DateRangeFilter } from "../dashboard/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAppContext } from "@/server/auth/current";
import { storeToday } from "@/server/services/dashboard";
import { listSales } from "@/server/services/sales";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "Sales history" };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { store } = await requireAppContext();
  const sp = await searchParams;
  const today = await storeToday(store);
  let from = isDate(sp.from) ? sp.from! : today;
  let to = isDate(sp.to) ? sp.to! : from;
  if (from > to) [from, to] = [to, from];
  const list = await listSales(store, { from, to, limit: 200 });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales history"
        description={`${list.total} sale(s) · ${formatPeso(list.completedTotalCentavos)} completed`}
        actions={<Button asChild><Link href="/sell"><ShoppingCart /> New sale</Link></Button>}
      />
      <DateRangeFilter from={from} to={to} today={today} />
      {list.items.length === 0 ? (
        <EmptyState icon={Receipt} title="No sales in this period" description="Try another date range." />
      ) : (
        <ul className="bg-card divide-y rounded-xl border">
          {list.items.map((s) => (
            <li key={s.id}>
              <Link href={`/sales/${s.id}`} className="hover:bg-muted/50 flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Sale #{s.sale_no}
                    {s.customer ? ` · ${s.customer}` : ""}
                  </p>
                  <p className="text-muted-foreground text-xs">{fmt.format(new Date(s.occurred_at))} · {s.items} item(s) · {s.cashier ?? "—"}</p>
                </div>
                {s.status === "voided" ? (
                  <Badge variant="outline">Voided</Badge>
                ) : (
                  <Badge variant={s.payment_method === "credit" ? "destructive" : "secondary"} className="uppercase">{s.payment_method === "credit" ? "utang" : s.payment_method}</Badge>
                )}
                <span className={`num w-24 text-right font-semibold ${s.status === "voided" ? "text-muted-foreground line-through" : ""}`}>{formatPeso(s.total_centavos)}</span>
                <ChevronRight className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
