import { ok, storeRoute } from "@/server/http";
import { getSale } from "@/server/services/sales";

export const GET = storeRoute<{ storeId: string; saleId: string }>(async (_req, { store, params }) => ok(await getSale(store, params.saleId)));
