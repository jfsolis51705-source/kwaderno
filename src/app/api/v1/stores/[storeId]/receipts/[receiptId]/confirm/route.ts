import { ok, readJson, storeRoute } from "@/server/http";
import { confirmReceipt } from "@/server/services/receipts";

/** Applies the merchant-reviewed lines as one stock-in. Idempotent; a receipt can be confirmed once. */
export const POST = storeRoute<{ storeId: string; receiptId: string }>(async (req, { store, params }) => {
  const r = await confirmReceipt(store, params.receiptId, await readJson(req));
  return ok(r, r.replayed ? 200 : 201);
});
