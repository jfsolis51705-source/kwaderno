import { ok, readJson, storeRoute } from "@/server/http";
import { voidSale } from "@/server/services/sales";

export const POST = storeRoute<{ storeId: string; saleId: string }>(async (req, { store, params }) => ok(await voidSale(store, params.saleId, await readJson(req))), "manager");
