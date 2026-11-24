import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { requireAppContext } from "@/server/auth/current";
import { listAudit } from "@/server/services/audit";
import { hasRole } from "@/server/services/stores";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };
const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const GROUPS = [
  { v: "", label: "All" }, { v: "sale.", label: "Sales" }, { v: "inventory.", label: "Stock" }, { v: "purchase.", label: "Stock-in" },
  { v: "receipt.", label: "Receipts" }, { v: "customer.", label: "Customers" }, { v: "product.", label: "Products" }, { v: "member.", label: "Team" }, { v: "store.", label: "Store" },
];
const describe = (a: string) =>
  ({
    "sale.create": "Recorded a sale", "sale.void": "Voided a sale", "customer.payment": "Recorded an utang payment", "customer.create": "Added a customer",
    "customer.update": "Edited a customer", "product.create": "Added a product", "product.update": "Edited a product", "product.archive": "Archived a product",
    "product.restore": "Restored a product", "purchase.create": "Recorded a stock-in", "receipt.upload": "Uploaded a receipt", "receipt.confirm": "Confirmed a receipt",
    "receipt.reject": "Rejected a receipt", "inventory.count": "Saved a stock count", "barcode.add": "Added a barcode", "barcode.remove": "Removed a barcode",
    "store.create": "Created the store", "store.update": "Edited the store profile", "member.add": "Added a team member", "member.role": "Changed a role", "member.remove": "Removed a team member",
  })[a] ?? (a.startsWith("inventory.") ? `Stock: ${a.split(".")[1].replace("_", " ")}` : a);

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { store } = await requireAppContext();
  if (!hasRole(store, "manager")) redirect("/dashboard");
  const sp = await searchParams;
  const action = GROUPS.some((g) => g.v === sp.action) ? sp.action ?? "" : "";
  const rows = await listAudit(store, { action: action || undefined, limit: 200 });
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Every important change: who did it, when, and what it looked like before and after." />
      <nav className="flex gap-2 overflow-x-auto pb-1">
        {GROUPS.map((g) => (
          <Link key={g.label} href={g.v ? `/audit?action=${g.v}` : "/audit"} className={cn("rounded-full border px-3 py-1.5 text-sm whitespace-nowrap", action === g.v ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>{g.label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No entries" />
      ) : (
        <ul className="bg-card divide-y rounded-xl border">
          {rows.map((r) => (
            <li key={r.id} className="p-3">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="font-medium">{describe(r.action)}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{r.action}</Badge>
                  <span className="text-muted-foreground ml-auto text-xs">{r.user_name ?? "System"} · {fmt.format(new Date(r.created_at))}</span>
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {r.before != null && <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 text-xs"><b>Before</b>{"\n"}{JSON.stringify(r.before, null, 2)}</pre>}
                  {r.after != null && <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 text-xs"><b>After</b>{"\n"}{JSON.stringify(r.after, null, 2)}</pre>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
