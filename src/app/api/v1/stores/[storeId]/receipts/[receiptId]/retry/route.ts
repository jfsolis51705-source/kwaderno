import { NextResponse } from "next/server";
import { storeRoute } from "@/server/http";
import { runInBackground } from "@/server/background";
import { processReceipt, retryReceipt } from "@/server/services/receipts";

export const POST = storeRoute<{ storeId: string; receiptId: string }>(async (_req, { store, params }) => {
  await retryReceipt(store, params.receiptId);
  if (process.env.RECEIPT_AUTO_PROCESS !== "0") runInBackground(() => processReceipt(store.storeId, params.receiptId));
  return NextResponse.json({ data: { queued: true } }, { status: 202 });
});
