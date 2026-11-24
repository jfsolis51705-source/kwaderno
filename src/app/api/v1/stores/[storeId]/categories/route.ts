import { ok, readJson, storeRoute } from "@/server/http";
import { createCategory, listCategories } from "@/server/services/catalog";

export const GET = storeRoute(async (_req, { store }) => ok(await listCategories(store)));
export const POST = storeRoute(async (req, { store }) => ok(await createCategory(store, await readJson(req)), 201));
