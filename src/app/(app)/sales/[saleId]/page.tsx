import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ReceiptView } from "@/components/sales/receipt-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { orNotFound } from "@/server/page-helpers";
import { getSale } from "@/server/services/sales";
import { hasRole } from "@/server/services/stores";
import { SaleActions } from "./sale-actions";

export const metadata: Metadata = { title: "Sale" };

export default async function SalePage({ params, searchParams }: { params: Promise<{ saleId: string }>; searchParams: Promise<{ print?: string }> }) {
  const { store } = await requireAppContext();
  const [{ saleId }, sp] = await Promise.all([params, searchParams]);
  const sale = await orNotFound(getSale(store, saleId));
  const change = sale.paymentMethod === "cash" && sale.amountTenderedCentavos != null ? sale.amountTenderedCentavos - sale.totalCentavos : null;
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader
          title={`Sale #${sale.saleNo}`}
          description={sale.cashier ? `Recorded by ${sale.cashier}` : undefined}
          actions={<SaleActions storeId={store.storeId} saleId={sale.id} canVoid={hasRole(store, "manager") && sale.status !== "voided"} autoPrint={sp.print === "1"} />}
        />
      </div>
      {sale.status === "voided" && (
        <Alert variant="warning" className="print:hidden"><AlertDescription>Voided: {sale.voidReason}</AlertDescription></Alert>
      )}
      <Card className="max-w-md print:border-0 print:shadow-none">
        <CardContent>
          <ReceiptView sale={sale} changeCentavos={change} />
        </CardContent>
      </Card>
    </div>
  );
}
