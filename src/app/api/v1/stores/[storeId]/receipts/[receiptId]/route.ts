import { ok, storeRoute } from "@/server/http";
import { getReceipt } from "@/server/services/receipts";

export const GET = storeRoute<{ storeId: string; receiptId: string }>(async (_req, { store, params }) => ok(await getReceipt(store, params.receiptId)));
