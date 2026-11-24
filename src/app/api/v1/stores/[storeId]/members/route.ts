import { ok, readJson, storeRoute } from "@/server/http";
import { addMember, listMembers } from "@/server/services/stores";

export const GET = storeRoute(async (_req, { store }) => ok(await listMembers(store)));
export const POST = storeRoute(async (req, { store }) => ok(await addMember(store, await readJson(req)), 201), "owner");
