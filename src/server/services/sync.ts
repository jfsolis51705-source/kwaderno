import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { devices, syncOperations } from "@/db/schema";
import { AppError } from "@/server/errors";
import { recordAdjustment } from "./inventory";
import { recordCustomerPayment } from "./customers";
import { createSale } from "./sales";
import type { StoreContext } from "./stores";

/** Operation types a device may queue while offline. */
export const SYNC_OP_TYPES = ["sale.create", "inventory.adjust", "customer.payment"] as const;

const opSchema = z.object({
  operationId: z.uuid(),
  opType: z.enum(SYNC_OP_TYPES),
  payload: z.record(z.string(), z.unknown()),
  clientCreatedAt: z.iso.datetime({ offset: true }).optional(),
});
export const syncSchema = z.object({
  deviceId: z.string().trim().min(8).max(100),
  deviceLabel: z.string().trim().max(120).optional(),
  operations: z.array(opSchema).max(100),
});

export type SyncResult = { operationId: string; status: "applied" | "conflict" | "failed"; result?: unknown; error?: { code: string; message: string } };

/** Errors that need a person to decide (never retried automatically). */
const CONFLICT_CODES = new Set(["INSUFFICIENT_STOCK", "CONFLICT", "NOT_FOUND", "VALIDATION_ERROR", "FORBIDDEN"]);

/**
 * Applies queued offline operations in order. Each operation is idempotent on its
 * operationId (stored in sync_operations and used as the domain idempotency key), so
 * resending a batch after a dropped connection never double-applies.
 * Conflicts are reported back — nothing is silently overwritten.
 */
export async function applySync(ctx: StoreContext, input: unknown, userAgent?: string | null) {
  const d = syncSchema.parse(input);
  const db = getDb();
  const [device] = await db
    .insert(devices)
    .values({ storeId: ctx.storeId, userId: ctx.userId, clientDeviceId: d.deviceId, label: d.deviceLabel ?? null, userAgent: userAgent ?? null })
    .onConflictDoUpdate({ target: [devices.storeId, devices.clientDeviceId], set: { lastSeenAt: new Date(), userId: ctx.userId, userAgent: userAgent ?? null } })
    .returning({ id: devices.id });

  const results: SyncResult[] = [];
  for (const op of d.operations) {
    const [existing] = await db
      .select()
      .from(syncOperations)
      .where(and(eq(syncOperations.storeId, ctx.storeId), eq(syncOperations.operationId, op.operationId)));
    if (existing?.status === "applied") {
      results.push({ operationId: op.operationId, status: "applied", result: existing.result });
      continue;
    }
    if (!existing) {
      await db
        .insert(syncOperations)
        .values({ storeId: ctx.storeId, deviceId: device.id, userId: ctx.userId, operationId: op.operationId, opType: op.opType, payload: op.payload, clientCreatedAt: op.clientCreatedAt ? new Date(op.clientCreatedAt) : null })
        .onConflictDoNothing();
    }
    try {
      const payload = { ...op.payload, idempotencyKey: op.operationId };
      let result: unknown;
      if (op.opType === "sale.create") {
        const s = await createSale(ctx, payload);
        result = { saleId: s.id, saleNo: s.saleNo, totalCentavos: s.totalCentavos };
      } else if (op.opType === "inventory.adjust") {
        const r = await recordAdjustment(ctx, payload);
        result = { transactionId: r.transaction.id };
      } else {
        const customerId = String(op.payload.customerId ?? "");
        const r = await recordCustomerPayment(ctx, customerId, payload);
        result = { paymentId: r.payment.id, balanceCentavos: r.balanceCentavos };
      }
      await db.update(syncOperations).set({ status: "applied", result: result as object, errorMessage: null, appliedAt: new Date() }).where(and(eq(syncOperations.storeId, ctx.storeId), eq(syncOperations.operationId, op.operationId)));
      results.push({ operationId: op.operationId, status: "applied", result });
    } catch (e) {
      const code = e instanceof AppError ? e.code : e instanceof z.ZodError ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      const message = e instanceof AppError ? e.message : e instanceof z.ZodError ? "The saved data is invalid" : "Server error";
      if (code === "INTERNAL_ERROR") console.error("[kwaderno] sync op failed", op.operationId, e);
      const status = CONFLICT_CODES.has(code) ? "conflict" : "failed";
      await db.update(syncOperations).set({ status, errorMessage: `${code}: ${message}` }).where(and(eq(syncOperations.storeId, ctx.storeId), eq(syncOperations.operationId, op.operationId)));
      results.push({ operationId: op.operationId, status, error: { code, message } });
    }
  }
  return { results, serverTime: new Date().toISOString() };
}

export async function listSyncOperations(ctx: StoreContext, limit = 100) {
  const r = await getDb().execute(sql`
    select o.operation_id, o.op_type, o.status, o.error_message, o.client_created_at, o.created_at, o.applied_at, d.label device, u.full_name by
    from sync_operations o left join devices d on d.id = o.device_id left join users u on u.id = o.user_id
    where o.store_id = ${ctx.storeId} order by o.created_at desc limit ${limit}`);
  return r.rows;
}
