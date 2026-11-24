import { ok, readJson, storeRoute } from "@/server/http";
import { createSale, listSales } from "@/server/services/sales";

export const GET = storeRoute(async (req, { store }) => ok(await listSales(store, Object.fromEntries(req.nextUrl.searchParams))));
/** Idempotent on idempotencyKey: a retry returns the original sale with replayed=true (200). */
export const POST = storeRoute(async (req, { store }) => {
  const sale = await createSale(store, await readJson(req));
  return ok(sale, sale.replayed ? 200 : 201);
});
