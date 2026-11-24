import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, HandCoins, PackagePlus, ReceiptText, ScanLine, ShoppingCart, UserPlus, Wallet, Receipt, Barcode, Plus } from "lucide-react";
import { DashboardMetricCard } from "@/components/app/dashboard-metric-card";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { getDashboard, storeToday } from "@/server/services/dashboard";
import { expirySummary } from "@/server/services/expiry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatPeso, formatQty } from "@/lib/money";
import { DateRangeFilter } from "./date-range-filter";

export const metadata: Metadata = { title: "Dashboard" };

const QUICK = [
  { href: "/scan", label: "Scan barcode", icon: Barcode },
  { href: "/receipts", label: "Scan receipt", icon: ReceiptText },
  { href: "/products/new", label: "Add product", icon: Plus },
  { href: "/stock-in", label: "Stock-in", icon: PackagePlus },
  { href: "/sell", label: "Record sale", icon: ShoppingCart },
  { href: "/customers?new=1", label: "Add customer", icon: UserPlus },
];

const TXN_LABEL: Record<string, string> = {
  opening: "Opening stock", stock_in: "Stock-in", sale: "Sale", adjustment: "Adjustment", damaged: "Damaged", expired: "Expired",
  supplier_return: "Return to supplier", customer_return: "Customer return", count_correction: "Count correction",
  repack_out: "Repack (out)", repack_in: "Repack (in)", sale_void: "Sale voided",
};

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { store, active } = await requireAppContext();
  const sp = await searchParams;
  const today = await storeToday(store);
  let from = isDate(sp.from) ? sp.from! : today;
  let to = isDate(sp.to) ? sp.to! : from;
  if (from > to) [from, to] = [to, from];
  const [d, exp] = await Promise.all([getDashboard(store, { from, to }), expirySummary(store)]);
  const isToday = from === today && to === today;
  const periodLabel = isToday ? "Today" : from === to ? from : `${from} → ${to}`;
  const fmtTime = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">Magandang araw 👋</p>
          <h1 className="text-2xl font-semibold tracking-tight">{active.name}</h1>
        </div>
        <DateRangeFilter from={from} to={to} today={today} />
      </div>

      {(exp.expired > 0 || exp.soon > 0) && (
        <Alert variant={exp.expired ? "destructive" : "warning"}>
          <AlertTriangle />
          <AlertTitle>{exp.expired ? `${exp.expired} batch(es) expired` : `${exp.soon} batch(es) expire this week`}</AlertTitle>
          <AlertDescription>
            <p>{exp.expired && exp.soon ? `${exp.soon} more expire within 7 days. ` : ""}<Link href="/expiry" className="font-medium underline">Check the expiry list</Link> and move them to the front or remove them.</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Quick actions: camera-first on phones, compact row on desktop */}
      <section aria-label="Quick actions" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {QUICK.map((q) => (
          <Button key={q.label} asChild variant="outline" className="h-auto flex-col gap-1.5 py-3 text-xs whitespace-normal sm:text-sm">
            <Link href={q.href}>
              <q.icon className="text-primary size-6!" />
              {q.label}
            </Link>
          </Button>
        ))}
      </section>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <DashboardMetricCard label={`Sales · ${periodLabel}`} value={formatPeso(d.sales.totalCentavos)} hint={`Cash ${formatPeso(d.sales.byMethod.cash)}`} icon={Wallet} />
        <DashboardMetricCard label="Transactions" value={String(d.sales.count)} hint={`GCash ${formatPeso(d.sales.byMethod.gcash)}`} icon={Receipt} />
        <DashboardMetricCard label="Products" value={String(d.productCount)} hint="Active in catalog" icon={Boxes} href="/products" />
        <DashboardMetricCard label="Inventory value" value={formatPeso(d.inventoryValueCentavos)} hint="At purchase cost" icon={ScanLine} />
        <DashboardMetricCard label="Low stock" value={String(d.lowStock.count)} hint="At or below reorder level" icon={AlertTriangle} tone={d.lowStock.count ? "warning" : "default"} href="/products?filter=low" />
        <DashboardMetricCard label="Utang outstanding" value={formatPeso(d.utang.outstandingCentavos)} hint={`${d.utang.customers} customer(s)`} icon={HandCoins} tone={d.utang.outstandingCentavos ? "danger" : "default"} href="/customers" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent sales</CardTitle>
            <CardAction>
              <Button asChild variant="link" size="sm"><Link href="/sales">All sales</Link></Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {d.recentSales.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="No sales yet" description="Sales you record will appear here." action={<Button asChild><Link href="/sell">Record a sale</Link></Button>} />
            ) : (
              <ul className="divide-y">
                {d.recentSales.map((s) => (
                  <li key={s.id}><Link href={`/sales/${s.id}`} className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-lg px-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">Sale #{s.sale_no}{s.customer ? ` · ${s.customer}` : ""}</p>
                      <p className="text-muted-foreground text-xs">{fmtTime.format(new Date(s.occurred_at))} · {s.items} item(s)</p>
                    </div>
                    <Badge variant={s.payment_method === "credit" ? "destructive" : "secondary"} className="uppercase">{s.payment_method === "credit" ? "utang" : s.payment_method}</Badge>
                    <span className="num w-24 text-right font-semibold">{formatPeso(s.total_centavos)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low stock</CardTitle>
          </CardHeader>
          <CardContent>
            {d.lowStock.items.length === 0 ? (
              <EmptyState icon={Boxes} title="Nothing low" description={d.productCount ? "All products are above their reorder level." : "Add products to start tracking stock."} />
            ) : (
              <ul className="divide-y">
                {d.lowStock.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="truncate text-sm">{p.name}</span>
                    <Badge variant={Number(p.quantity) <= 0 ? "destructive" : "warning"} className="num">
                      {formatQty(p.quantity)} {p.unit}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent stock movements</CardTitle>
        </CardHeader>
        <CardContent>
          {d.recentMovements.length === 0 ? (
            <EmptyState icon={PackagePlus} title="No stock movements yet" description="Every stock-in, sale and adjustment is recorded here." />
          ) : (
            <ul className="divide-y">
              {d.recentMovements.map((m) => {
                const up = Number(m.quantity_delta) > 0;
                return (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    {up ? <ArrowUpRight className="text-success size-5" /> : <ArrowDownRight className="text-destructive size-5" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.product}</p>
                      <p className="text-muted-foreground text-xs">{TXN_LABEL[m.type] ?? m.type} · {m.by ?? "—"} · {fmtTime.format(new Date(m.created_at))}</p>
                    </div>
                    <span className={`num text-sm font-semibold ${up ? "text-success" : "text-destructive"}`}>
                      {up ? "+" : ""}{formatQty(m.quantity_delta)} {m.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
