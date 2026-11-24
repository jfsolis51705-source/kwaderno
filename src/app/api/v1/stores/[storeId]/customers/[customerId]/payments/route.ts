import { ok, readJson, storeRoute } from "@/server/http";
import { recordCustomerPayment } from "@/server/services/customers";

/** Utang payment (partial or full). Idempotent on idempotencyKey. */
export const POST = storeRoute<{ storeId: string; customerId: string }>(async (req, { store, params }) => {
  const r = await recordCustomerPayment(store, params.customerId, await readJson(req));
  return ok(r, r.replayed ? 200 : 201);
});
