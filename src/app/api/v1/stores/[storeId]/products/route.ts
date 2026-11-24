import { ok, readJson, storeRoute } from "@/server/http";
import { createProduct, listProducts } from "@/server/services/catalog";

export const GET = storeRoute(async (req, { store }) => ok(await listProducts(store, Object.fromEntries(req.nextUrl.searchParams))));
export const POST = storeRoute(async (req, { store }) => ok(await createProduct(store, await readJson(req)), 201));
