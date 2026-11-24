import { ok, readJson, storeRoute } from "@/server/http";
import { recordRepack } from "@/server/services/inventory";

/** Idempotent: repeating a request with the same idempotencyKey returns the original result with replayed=true. */
export const POST = storeRoute(async (req, { store }) => {
  const result = await recordRepack(store, await readJson(req));
  return ok(result, result.replayed ? 200 : 201);
});
