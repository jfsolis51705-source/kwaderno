import { ok, storeRoute } from "@/server/http";
import { listAudit } from "@/server/services/audit";

export const GET = storeRoute(async (req, { store }) => ok(await listAudit(store, Object.fromEntries(req.nextUrl.searchParams))), "manager");
