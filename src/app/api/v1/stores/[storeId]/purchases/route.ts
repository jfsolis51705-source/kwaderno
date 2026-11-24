import { ok, storeRoute } from "@/server/http";
import { listPurchases } from "@/server/services/inventory";

export const GET = storeRoute(async (_req, { store }) => ok(await listPurchases(store)));
