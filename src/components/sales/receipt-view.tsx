import { formatPeso, formatQty } from "@/lib/money";
import type { SaleDetail } from "@/server/services/sales";

const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const METHOD: Record<string, string> = { cash: "Cash", gcash: "GCash", credit: "Utang" };

/** Simple receipt layout used on screen, in print, and as share text. Not an official BIR receipt. */
export function ReceiptView({ sale, changeCentavos }: { sale: SaleDetail; changeCentavos?: number | null }) {
  return (
    <div className="mx-auto w-full max-w-xs space-y-3 font-mono text-sm" id="receipt">
      <div className="text-center">
        <p className="font-sans text-base font-semibold">{sale.storeName}</p>
        <p className="text-muted-foreground text-xs">Sale #{sale.saleNo} · {fmt.format(new Date(sale.occurredAt))}</p>
        {sale.status === "voided" && <p className="text-destructive font-sans font-semibold">VOIDED</p>}
      </div>
      <div className="border-y border-dashed py-2">
        {sale.items.map((i) => (
          <div key={i.productId} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{formatQty(i.quantity)} × {i.name}</span>
            <span className="num">{formatPeso(i.lineTotalCentavos)}</span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5">
        {sale.discountCentavos > 0 && (
          <>
            <div className="flex justify-between"><span>Subtotal</span><span className="num">{formatPeso(sale.subtotalCentavos)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span className="num">−{formatPeso(sale.discountCentavos)}</span></div>
          </>
        )}
        <div className="flex justify-between text-base font-bold"><span>TOTAL</span><span className="num">{formatPeso(sale.totalCentavos)}</span></div>
        <div className="flex justify-between"><span>{METHOD[sale.paymentMethod]}</span><span className="num">{formatPeso(sale.paymentMethod === "cash" ? (sale.amountTenderedCentavos ?? sale.totalCentavos) : sale.totalCentavos)}</span></div>
        {sale.paymentMethod === "cash" && changeCentavos != null && changeCentavos > 0 && (
          <div className="flex justify-between font-semibold"><span>Change</span><span className="num">{formatPeso(changeCentavos)}</span></div>
        )}
        {sale.paymentMethod === "gcash" && sale.payments[0]?.referenceNo && <p className="text-xs">GCash ref: {sale.payments[0].referenceNo}</p>}
        {sale.customer && <p className="text-xs">Customer: {sale.customer.name}</p>}
      </div>
      <p className="text-muted-foreground text-center text-xs">Salamat po! · This is not an official receipt.</p>
    </div>
  );
}

export function receiptText(sale: SaleDetail) {
  const lines = [
    sale.storeName,
    `Sale #${sale.saleNo} · ${fmt.format(new Date(sale.occurredAt))}`,
    "",
    ...sale.items.map((i) => `${formatQty(i.quantity)} x ${i.name}  ${formatPeso(i.lineTotalCentavos)}`),
    "",
    ...(sale.discountCentavos ? [`Discount -${formatPeso(sale.discountCentavos)}`] : []),
    `TOTAL ${formatPeso(sale.totalCentavos)} (${METHOD[sale.paymentMethod]})`,
    "Salamat po!",
  ];
  return lines.join("\n");
}
