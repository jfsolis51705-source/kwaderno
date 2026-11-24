import Link from "next/link";
import { EmptyState } from "@/components/app/states";
import { formatPeso } from "@/lib/money";

const LABEL: Record<string, string> = { credit_sale: "Utang (sale)", payment: "Payment", adjustment: "Adjustment", sale_void: "Sale voided" };
const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export interface LedgerRow {
  id: string; entry_type: string; amount_centavos: number; balance_after_centavos: number; note: string | null; created_at: Date;
  sale_id: string | null; sale_no: number | null; payment_method: string | null; reference_no: string | null; by: string | null;
}

/** Append-only utang history: every credit and payment with the running balance. */
export function CustomerLedger({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length) return <EmptyState title="No utang history" description="Credit sales and payments will appear here." />;
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const owes = r.amount_centavos > 0;
        return (
          <li key={r.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {LABEL[r.entry_type] ?? r.entry_type}
                {r.sale_id && r.sale_no != null && <> · <Link className="text-primary hover:underline" href={`/sales/${r.sale_id}`}>Sale #{r.sale_no}</Link></>}
                {r.payment_method && <span className="text-muted-foreground"> · {r.payment_method === "gcash" ? "GCash" : "Cash"}{r.reference_no ? ` ref ${r.reference_no}` : ""}</span>}
              </p>
              <p className="text-muted-foreground text-xs">{fmt.format(new Date(r.created_at))}{r.by ? ` · ${r.by}` : ""}{r.note && r.entry_type === "payment" ? ` · ${r.note}` : ""}</p>
            </div>
            <div className="text-right">
              <p className={`num text-sm font-semibold ${owes ? "text-destructive" : "text-success"}`}>{owes ? "+" : "−"}{formatPeso(Math.abs(r.amount_centavos))}</p>
              <p className="num text-muted-foreground text-xs">Balance {formatPeso(r.balance_after_centavos)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
