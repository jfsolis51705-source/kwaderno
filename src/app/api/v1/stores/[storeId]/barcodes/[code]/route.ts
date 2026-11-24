import { ok, storeRoute } from "@/server/http";
import { lookupBarcode } from "@/server/services/catalog";

/** 200 with `{ found: false }` for unknown codes so scanners can offer registration without error handling. */
export const GET = storeRoute<{ storeId: string; code: string }>(async (_req, { store, params }) => {
  const product = await lookupBarcode(store, decodeURIComponent(params.code));
  return ok({ found: !!product, product });
});
