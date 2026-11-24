import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, Pencil, Phone, ShoppingCart } from "lucide-react";
import { CustomerFormDialog } from "@/components/customers/customer-form";
import { CustomerLedger } from "@/components/customers/customer-ledger";
import { PaymentFormDialog } from "@/components/customers/payment-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { orNotFound } from "@/server/page-helpers";
import { getCustomer } from "@/server/services/customers";
import { hasRole } from "@/server/services/stores";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { store } = await requireAppContext();
  const { customerId } = await params;
  const c = await orNotFound(getCustomer(store, customerId));
  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        description={[c.phone, c.address].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {c.balanceCentavos > 0 && (
              <PaymentFormDialog storeId={store.storeId} customerId={c.id} name={c.name} balanceCentavos={c.balanceCentavos} trigger={<Button><HandCoins /> Record payment</Button>} />
            )}
            {c.phone && <Button asChild variant="outline"><a href={`tel:${c.phone}`}><Phone /> Call</a></Button>}
            <CustomerFormDialog
              storeId={store.storeId}
              canSetLimit={hasRole(store, "manager")}
              initial={{ id: c.id, name: c.name, phone: c.phone, address: c.address, notes: c.notes, creditLimitCentavos: c.creditLimitCentavos }}
              trigger={<Button variant="outline"><Pencil /> Edit</Button>}
            />
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-1 px-4 py-4">
          <p className="text-muted-foreground text-sm">Utang balance</p>
          <p className={`num text-2xl font-bold ${c.balanceCentavos > 0 ? "text-destructive" : ""}`}>{formatPeso(c.balanceCentavos)}</p>
        </Card>
        <Card className="gap-1 px-4 py-4">
          <p className="text-muted-foreground text-sm">Utang limit</p>
          <p className="num text-2xl font-bold">{c.creditLimitCentavos == null ? "No limit" : formatPeso(c.creditLimitCentavos)}</p>
        </Card>
        <Card className="justify-center px-4 py-4">
          <Button asChild variant="outline"><Link href="/sell"><ShoppingCart /> New sale</Link></Button>
        </Card>
      </div>
      {c.notes && <p className="text-muted-foreground text-sm">Note: {c.notes}</p>}
      <Card>
        <CardHeader><CardTitle>Utang history</CardTitle></CardHeader>
        <CardContent><CustomerLedger rows={c.ledger} /></CardContent>
      </Card>
    </div>
  );
}
