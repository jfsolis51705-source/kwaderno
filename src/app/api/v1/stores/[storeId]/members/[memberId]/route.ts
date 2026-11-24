import { ok, readJson, storeRoute } from "@/server/http";
import { removeMember, updateMember } from "@/server/services/stores";

export const PATCH = storeRoute<{ storeId: string; memberId: string }>(
  async (req, { store, params }) => ok(await updateMember(store, params.memberId, await readJson(req))),
  "owner",
);
export const DELETE = storeRoute<{ storeId: string; memberId: string }>(async (_req, { store, params }) => {
  await removeMember(store, params.memberId);
  return ok({ ok: true });
}, "owner");
