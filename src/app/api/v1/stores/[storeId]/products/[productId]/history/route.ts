import { ok, storeRoute } from "@/server/http";
import { getProductHistory } from "@/server/services/inventory";

type P = { storeId: string; productId: string };
export const GET = storeRoute<P>(async (_req, { store, params }) => ok(await getProductHistory(store, params.productId)));
