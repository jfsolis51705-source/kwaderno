import { ok, readJson, storeRoute } from "@/server/http";
import { clearExpiry } from "@/server/services/expiry";

export const POST = storeRoute<{ storeId: string; expiryId: string }>(async (req, { store, params }) => {
  const r = await clearExpiry(store, params.expiryId, await readJson(req));
  return ok(r, r.replayed ? 200 : 201);
});
