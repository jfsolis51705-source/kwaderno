import { ok, readJson, storeRoute } from "@/server/http";
import { getProduct, updateProduct } from "@/server/services/catalog";

type P = { storeId: string; productId: string };
export const GET = storeRoute<P>(async (_req, { store, params }) => ok(await getProduct(store, params.productId)));
export const PATCH = storeRoute<P>(async (req, { store, params }) => ok(await updateProduct(store, params.productId, await readJson(req))), "manager");
