import { ok, storeRoute } from "@/server/http";
import { removeBarcode } from "@/server/services/catalog";

type P = { storeId: string; productId: string; barcode: string };
export const DELETE = storeRoute<P>(async (_req, { store, params }) => {
  await removeBarcode(store, params.productId, decodeURIComponent(params.barcode));
  return ok({ ok: true });
}, "manager");
