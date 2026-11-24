import { ok, storeRoute } from "@/server/http";
import { setArchived } from "@/server/services/catalog";

type P = { storeId: string; productId: string };
export const POST = storeRoute<P>(async (_req, { store, params }) => ok(await setArchived(store, params.productId, true)), "manager");
export const DELETE = storeRoute<P>(async (_req, { store, params }) => ok(await setArchived(store, params.productId, false)), "manager");
