import { ok, readJson, storeRoute } from "@/server/http";
import { getCustomer, updateCustomer } from "@/server/services/customers";

type P = { storeId: string; customerId: string };
/** Includes the full utang ledger (newest first). */
export const GET = storeRoute<P>(async (_req, { store, params }) => ok(await getCustomer(store, params.customerId)));
export const PATCH = storeRoute<P>(async (req, { store, params }) => ok(await updateCustomer(store, params.customerId, await readJson(req))));
