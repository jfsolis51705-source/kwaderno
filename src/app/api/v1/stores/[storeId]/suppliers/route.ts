import { ok, readJson, storeRoute } from "@/server/http";
import { listSuppliers } from "@/server/services/inventory";
import { getDb } from "@/db";
import { suppliers } from "@/db/schema";
import { supplierSchema } from "@/lib/validation-catalog";

export const GET = storeRoute(async (_req, { store }) => ok(await listSuppliers(store)));
export const POST = storeRoute(async (req, { store }) => {
  const d = supplierSchema.parse(await readJson(req));
  const [s] = await getDb().insert(suppliers).values({ ...d, storeId: store.storeId }).returning();
  return ok(s, 201);
});
