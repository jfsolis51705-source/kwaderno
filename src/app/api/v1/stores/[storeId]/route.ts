import { ok, readJson, storeRoute } from "@/server/http";
import { getStore, updateStore } from "@/server/services/stores";

export const GET = storeRoute(async (_req, { store }) => ok({ ...(await getStore(store)), myRole: store.role }));
export const PATCH = storeRoute(async (req, { store }) => ok(await updateStore(store, await readJson(req))), "manager");
