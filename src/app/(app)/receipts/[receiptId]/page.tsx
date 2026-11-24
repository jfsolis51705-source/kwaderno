import type { Metadata } from "next";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { ReceiptReviewTable, RetryButton } from "@/components/receipts/receipt-review-table";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/server/auth/current";
import { orNotFound } from "@/server/page-helpers";
import { getReceipt } from "@/server/services/receipts";

export const metadata: Metadata = { title: "Review receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { store } = await requireAppContext();
  const { receiptId } = await params;
  const r = await orNotFound(getReceipt(store, receiptId));
  const fileUrl = `/api/v1/stores/${store.storeId}/receipts/${r.id}/file`;
  const reading = r.status === "queued" || r.status === "processing";
  const editable = r.status === "pending_review" || r.status === "failed";
  return (
    <div className="space-y-4">
      <PageHeader title={r.supplierName ?? "Supplier receipt"} description={r.provider ? `Read by ${r.provider.split(":")[0]}` : undefined} actions={<ReceiptStatusBadge status={r.status} />} />
      <AutoRefresh active={reading} />
      {r.duplicateOf && r.status !== "confirmed" && (
        <Alert variant="warning"><AlertTitle>Possible duplicate</AlertTitle><AlertDescription><p>The same photo was uploaded before. <Link className="underline" href={`/receipts/${r.duplicateOf.id}`}>Open the other copy</Link>.</p></AlertDescription></Alert>
      )}
      {r.status === "failed" && (
        <Alert variant="destructive"><AlertTitle>Couldn&apos;t read this receipt automatically</AlertTitle><AlertDescription><p>{r.errorMessage}</p><p>You can try again, or type the items below.</p><div className="mt-2"><RetryButton storeId={store.storeId} receiptId={r.id} /></div></AlertDescription></Alert>
      )}
      {r.status === "confirmed" && <Alert><AlertTitle>Stock-in recorded</AlertTitle><AlertDescription>Confirmed {r.confirmedAt ? new Date(r.confirmedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : ""}. Changes appear in each product&apos;s stock history.</AlertDescription></Alert>}
      {r.status === "rejected" && <Alert><AlertTitle>Rejected</AlertTitle><AlertDescription>{r.rejectedReason}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="h-fit overflow-hidden p-0 lg:sticky lg:top-20">
          <CardContent className="p-0">
            {r.mimeType === "application/pdf" ? (
              <iframe src={fileUrl} title="Receipt PDF" className="h-[70vh] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- private, auth-protected file; not optimisable
              <a href={fileUrl} target="_blank" rel="noreferrer"><img src={fileUrl} alt="Uploaded receipt" className="max-h-[75vh] w-full object-contain bg-black/5" /></a>
            )}
          </CardContent>
        </Card>
        <div>
          {reading ? (
            <Card><CardContent className="flex items-center gap-3 py-6"><Loader2 className="text-primary size-5 animate-spin" /><div><p className="font-medium">Reading your receipt…</p><p className="text-muted-foreground text-sm">This usually takes a few seconds. You can leave this page.</p></div></CardContent></Card>
          ) : (
            <ReceiptReviewTable storeId={store.storeId} receipt={r} editable={editable} />
          )}
        </div>
      </div>
    </div>
  );
}
