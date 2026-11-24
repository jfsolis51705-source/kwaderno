import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { ok, storeRoute } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { maxUploadBytes } from "@/server/storage";
import { runInBackground } from "@/server/background";
import { listReceipts, processReceipt, uploadReceipt } from "@/server/services/receipts";

export const GET = storeRoute(async (_req, { store }) => ok(await listReceipts(store)));

/** multipart/form-data with a `file` field (JPG, PNG, WebP or PDF). Returns 202: processing continues in the background. */
export const POST = storeRoute(async (req, { store }) => {
  rateLimit(`receipt-upload:${store.userId}`, 60, 60 * 60 * 1000);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxUploadBytes() + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", `File is larger than ${process.env.MAX_UPLOAD_MB ?? 10} MB`);
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Send the receipt as multipart form data with a 'file' field");
  }
  if (!file) throw new AppError("VALIDATION_ERROR", "Choose a receipt photo or PDF");
  const result = await uploadReceipt(store, { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name });
  if (process.env.RECEIPT_AUTO_PROCESS !== "0") runInBackground(() => processReceipt(store.storeId, result.receipt.id));
  return NextResponse.json({ data: result }, { status: 202 });
});
