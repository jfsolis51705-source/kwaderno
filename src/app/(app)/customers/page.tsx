import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, HandCoins, Search, UserPlus, Users } from "lucide-react";
import { CustomerFormDialog } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAppContext } from "@/server/auth/current";
import { listCustomers } from "@/server/services/customers";
import { hasRole } from "@/server/services/stores";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers & Utang" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; new?: string }> }) {
  const { store } = await requireAppContext();
  const sp = await searchParams;
  const filter = sp.filter === "owing" ? "owing" : "all";
  const [list, owing] = await Promise.all([listCustomers(store, { q: sp.q || undefined, filter, limit: 200 }), listCustomers(store, { filter: "owing", limit: 1 })]);
  const canLimit = hasRole(store, "manager");
  const addButton = <Button><UserPlus /> Add customer</Button>;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers & Utang"
        description={`${list.total} customer(s)`}
        actions={<CustomerFormDialog storeId={store.storeId} canSetLimit={canLimit} trigger={addButton} defaultOpen={sp.new === "1"} />}
      />
      <Card className="py-4">
        <CardContent className="flex items-center gap-4">
          <span className="bg-destructive/10 text-destructive rounded-lg p-2.5"><HandCoins className="size-6" /></span>
          <div>
            <p className="text-muted-foreground text-sm">Total utang outstanding</p>
            <p className="num text-2xl font-bold">{formatPeso(owing.totalOwedCentavos)}</p>
            <p className="text-muted-foreground text-xs">{owing.total} customer(s) owe</p>
          </div>
        </CardContent>
      </Card>
      <form className="flex gap-2" action="/customers">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input name="q" defaultValue={sp.q} placeholder="Search name or mobile" className="pl-9" aria-label="Search customers" />
        </div>
        {filter === "owing" && <input type="hidden" name="filter" value="owing" />}
        <Button type="submit" variant="secondary" className="h-11">Search</Button>
      </form>
      <div className="flex gap-2">
        {(["all", "owing"] as const).map((f) => (
          <Link key={f} href={f === "all" ? "/customers" : "/customers?filter=owing"} className={cn("rounded-full border px-3 py-1.5 text-sm", filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>
            {f === "all" ? "All" : "With utang"}
          </Link>
        ))}
      </div>
      {list.items.length === 0 ? (
        <EmptyState icon={Users} title={sp.q || filter === "owing" ? "No matching customers" : "No customers yet"} description="Add customers who buy on utang to keep track of what they owe." />
      ) : (
        <ul className="bg-card divide-y rounded-xl border">
          {list.items.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="hover:bg-muted/50 flex items-center gap-3 p-3">
                <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-full font-semibold">{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{c.phone ?? "No mobile"}</p>
                </div>
                <span className={`num font-semibold ${c.balance_centavos > 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatPeso(c.balance_centavos)}</span>
                <ChevronRight className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
