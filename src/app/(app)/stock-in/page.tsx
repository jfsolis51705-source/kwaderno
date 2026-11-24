import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { StockInForm } from "@/components/inventory/stock-in-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { listPurchases, listSuppliers } from "@/server/services/inventory";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "Stock-in" };

export default async function StockInPage() {
  const { store } = await requireAppContext();
  const [suppliers, recent] = await Promise.all([listSuppliers(store), listPurchases(store, 10)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Stock-in" description="Record a delivery or purchase. Stock increases only after you confirm." />
      <StockInForm storeId={store.storeId} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
      {recent.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent stock-ins</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{r.purchaseDate} · {r.supplier ?? "No supplier"}{r.referenceNo ? ` · #${r.referenceNo}` : ""}</span>
                  <span className="num font-medium">{formatPeso(r.totalCentavos)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
