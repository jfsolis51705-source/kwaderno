import { ok, readJson, storeRoute } from "@/server/http";
import { rejectReceipt } from "@/server/services/receipts";

export const POST = storeRoute<{ storeId: string; receiptId: string }>(async (req, { store, params }) => {
  await rejectReceipt(store, params.receiptId, await readJson(req));
  return ok({ ok: true });
});
