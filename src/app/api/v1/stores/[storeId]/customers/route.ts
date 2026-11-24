import { ok, readJson, storeRoute } from "@/server/http";
import { createCustomer, listCustomers } from "@/server/services/customers";

export const GET = storeRoute(async (req, { store }) => ok(await listCustomers(store, Object.fromEntries(req.nextUrl.searchParams))));
export const POST = storeRoute(async (req, { store }) => ok(await createCustomer(store, await readJson(req)), 201));
