import { ok, readJson, storeRoute } from "@/server/http";
import { addBarcode } from "@/server/services/catalog";

type P = { storeId: string; productId: string };
export const POST = storeRoute<P>(async (req, { store, params }) => ok(await addBarcode(store, params.productId, await readJson(req)), 201));
