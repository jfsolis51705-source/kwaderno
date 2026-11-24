import { ok, storeRoute } from "@/server/http";
import { listProducts } from "@/server/services/catalog";

/** Current stock levels (same filters as /products). */
export const GET = storeRoute(async (req, { store }) => ok(await listProducts(store, Object.fromEntries(req.nextUrl.searchParams))));
