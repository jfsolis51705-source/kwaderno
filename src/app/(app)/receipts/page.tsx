import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status";
import { ReceiptUploader } from "@/components/receipts/receipt-uploader";
import { requireAppContext } from "@/server/auth/current";
import { listReceipts } from "@/server/services/receipts";
import { formatPeso } from "@/lib/money";

export const metadata: Metadata = { title: "Receipts" };
const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ReceiptsPage() {
  const { store } = await requireAppContext();
  const list = await listReceipts(store);
  const busy = list.some((r) => r.status === "queued" || r.status === "processing");
  return (
    <div className="space-y-5">
      <PageHeader title="Receipts" description="Supplier receipts become stock-in after you check them." />
      <ReceiptUploader storeId={store.storeId} />
      <AutoRefresh active={busy} />
      {list.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No receipts yet" description="Uploaded receipts and their status will be listed here." />
      ) : (
        <ul className="bg-card divide-y rounded-xl border">
          {list.map((r) => (
            <li key={r.id}>
              <Link href={`/receipts/${r.id}`} className="hover:bg-muted/50 flex items-center gap-3 p-3">
                <ReceiptText className="text-muted-foreground size-5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.supplierName ?? "Supplier receipt"}{r.receiptNumber ? ` · #${r.receiptNumber}` : ""}</p>
                  <p className="text-muted-foreground text-xs">{fmt.format(new Date(r.createdAt))} · {r.items} line(s){r.grandTotalCentavos != null ? ` · ${formatPeso(r.grandTotalCentavos)}` : ""}</p>
                </div>
                <ReceiptStatusBadge status={r.status} />
                <ChevronRight className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
