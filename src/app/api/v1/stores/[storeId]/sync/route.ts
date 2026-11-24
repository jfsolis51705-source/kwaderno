import { ok, readJson, storeRoute } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { applySync, listSyncOperations } from "@/server/services/sync";

/** Server-side log of operations received from devices (pending/applied/conflict/failed). */
export const GET = storeRoute(async (_req, { store }) => ok(await listSyncOperations(store)));

/** Batch of offline operations. Always 200 with a per-operation result; see docs/API.md. */
export const POST = storeRoute(async (req, { store }) => {
  rateLimit(`sync:${store.userId}`, 120, 60 * 1000);
  return ok(await applySync(store, await readJson(req), req.headers.get("user-agent")));
});
