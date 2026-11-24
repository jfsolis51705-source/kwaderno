import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import { inventoryTransactions, products, purchaseItems, purchases, suppliers } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { hasRole, type StoreContext } from "./stores";
import {
  adjustmentSchema,
  countSchema,
  DECREASE_TYPES,
  INCREASE_TYPES,
  repackSchema,
  stockInSchema,
} from "@/lib/validation-catalog";

type TxnType = (typeof inventoryTransactions.$inferInsert)["type"];

export const toQty = (n: number | string) => Number(n).toFixed(3);

export interface MovementInput {
  productId: string;
  type: TxnType;
  /** Signed change in the product's own unit. */
  delta: number | string;
  unitCostCentavos?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  /** Skip the negative-stock check (used for count corrections that set an absolute value). */
  allowNegative?: boolean;
}

/**
 * THE single way stock changes. Must be called inside a transaction.
 *
 * 1. Locks the product's balance row (SELECT … FOR UPDATE), creating it if missing,
 *    so concurrent movements on one product are serialised.
 * 2. Rejects decreases below zero unless the store allows negative stock.
 * 3. Updates the balance and appends an immutable ledger row with balance_after.
 */
export async function applyMovement(tx: Tx, ctx: StoreContext, m: MovementInput) {
  const delta = toQty(m.delta);
  if (Number(delta) === 0) throw new AppError("VALIDATION_ERROR", "Quantity change cannot be zero");

  const [p] = await tx
    .select({ id: products.id, name: products.name, unit: products.unit, archivedAt: products.archivedAt })
    .from(products)
    .where(and(eq(products.id, m.productId), eq(products.storeId, ctx.storeId)));
  if (!p) throw notFound("Product");
  if (p.archivedAt && Number(delta) > 0 && m.type !== "count_correction") {
    throw new AppError("CONFLICT", `"${p.name}" is archived. Restore it before adding stock.`);
  }

  await tx.execute(sql`insert into inventory_balances (product_id, store_id) values (${m.productId}, ${ctx.storeId}) on conflict (product_id) do nothing`);
  const locked = await tx.execute<{ quantity: string; would_be_negative: boolean; allow_negative: boolean }>(sql`
    select b.quantity::text, (b.quantity + ${delta}::numeric) < 0 as would_be_negative, s.allow_negative_stock as allow_negative
    from inventory_balances b join stores s on s.id = b.store_id
    where b.product_id = ${m.productId} and b.store_id = ${ctx.storeId}
    for update of b`);
  const row = locked.rows[0];
  if (Number(delta) < 0 && row.would_be_negative && !row.allow_negative && !m.allowNegative) {
    throw new AppError("INSUFFICIENT_STOCK", `Not enough stock for "${p.name}". On record: ${Number(row.quantity)} ${p.unit}.`, {
      productId: p.id,
      available: Number(row.quantity),
    });
  }

  const upd = await tx.execute<{ quantity: string }>(sql`
    update inventory_balances set quantity = quantity + ${delta}::numeric, version = version + 1, updated_at = now()
    where product_id = ${m.productId} returning quantity::text`);
  const balanceAfter = upd.rows[0].quantity;

  const [txn] = await tx
    .insert(inventoryTransactions)
    .values({
      storeId: ctx.storeId,
      productId: m.productId,
      type: m.type,
      quantityDelta: delta,
      balanceAfter,
      unitCostCentavos: m.unitCostCentavos ?? null,
      reason: m.reason ?? null,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      idempotencyKey: m.idempotencyKey ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  return txn;
}

/** Runs `fn` in a transaction; if an idempotency key collides (concurrent retry), returns `onReplay()`. */
async function idempotent<T>(fn: (tx: Tx) => Promise<T>, onReplay: () => Promise<T | null>): Promise<T> {
  try {
    return await getDb().transaction(fn);
  } catch (e) {
    const pg = (e as { cause?: { code?: string }; code?: string }).cause ?? (e as { code?: string });
    if (pg?.code === "23505") {
      const prev = await onReplay();
      if (prev) return prev;
    }
    throw e;
  }
}

const MANAGER_TYPES = new Set(["opening", "adjustment"]);

/** Single-product manual movement: stock-in, damaged, expired, returns, opening, adjustment. */
export async function recordAdjustment(ctx: StoreContext, input: unknown) {
  const d = adjustmentSchema.parse(input);
  if (MANAGER_TYPES.has(d.type) && !hasRole(ctx, "manager")) throw forbidden("Only owners and managers can record opening stock or general adjustments");
  const sign = INCREASE_TYPES.has(d.type) ? 1 : DECREASE_TYPES.has(d.type) ? -1 : d.direction === "increase" ? 1 : -1;

  const findPrev = async () => {
    const [prev] = await getDb()
      .select()
      .from(inventoryTransactions)
      .where(and(eq(inventoryTransactions.storeId, ctx.storeId), eq(inventoryTransactions.idempotencyKey, d.idempotencyKey), eq(inventoryTransactions.productId, d.productId)));
    return prev ? { transaction: prev, replayed: true } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;

  return idempotent(async (tx) => {
    const t = await applyMovement(tx, ctx, {
      productId: d.productId,
      type: d.type,
      delta: sign * d.quantity,
      unitCostCentavos: d.unitCostCentavos ?? null,
      reason: d.reason,
      referenceType: "manual",
      idempotencyKey: d.idempotencyKey,
    });
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: `inventory.${d.type}`, entityType: "inventory_transaction", entityId: t.id, after: t, ip: ctx.ip });
    return { transaction: t, replayed: false };
  }, findPrev);
}

/** Multi-line stock-in from a supplier delivery. Creates a purchase + one stock_in movement per line. */
export async function recordStockIn(ctx: StoreContext, input: unknown, opts: { receiptId?: string; receiptItemIds?: (string | null)[]; tx?: Tx } = {}) {
  const d = stockInSchema.parse(input);
  const findPrev = async () => {
    const [prev] = await getDb().select().from(purchases).where(and(eq(purchases.storeId, ctx.storeId), eq(purchases.idempotencyKey, d.idempotencyKey)));
    return prev ? { purchase: prev, replayed: true } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;

  const work = async (tx: Tx) => {
    let supplierId = d.supplierId ?? null;
    if (supplierId) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.storeId, ctx.storeId)));
      if (!s) throw notFound("Supplier");
    } else if (d.supplierName) {
      supplierId = await upsertSupplier(tx, ctx, d.supplierName);
    }
    const subtotal = d.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitCostCentavos), 0);
    const [purchase] = await tx
      .insert(purchases)
      .values({
        storeId: ctx.storeId,
        supplierId,
        receiptId: opts.receiptId ?? null,
        referenceNo: d.referenceNo,
        purchaseDate: d.purchaseDate ?? sql`(now() at time zone (select timezone from stores where id = ${ctx.storeId}))::date` as unknown as string,
        subtotalCentavos: subtotal,
        totalCentavos: subtotal,
        notes: d.notes,
        idempotencyKey: d.idempotencyKey,
        createdBy: ctx.userId,
      })
      .returning();

    for (const [i, l] of d.lines.entries()) {
      const lineTotal = Math.round(l.quantity * l.unitCostCentavos);
      await tx.insert(purchaseItems).values({
        purchaseId: purchase.id,
        storeId: ctx.storeId,
        productId: l.productId,
        quantity: toQty(l.quantity),
        unitCostCentavos: l.unitCostCentavos,
        lineTotalCentavos: lineTotal,
        receiptItemId: opts.receiptItemIds?.[i] ?? null,
      });
      await applyMovement(tx, ctx, {
        productId: l.productId,
        type: "stock_in",
        delta: l.quantity,
        unitCostCentavos: l.unitCostCentavos,
        reason: d.referenceNo ? `Delivery ${d.referenceNo}` : "Stock-in",
        referenceType: "purchase",
        referenceId: purchase.id,
      });
      if (d.updateProductCost && l.unitCostCentavos > 0) {
        await tx.update(products).set({ purchaseCostCentavos: l.unitCostCentavos }).where(and(eq(products.id, l.productId), eq(products.storeId, ctx.storeId)));
      }
    }
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "purchase.create", entityType: "purchase", entityId: purchase.id, after: { ...purchase, lines: d.lines }, ip: ctx.ip });
    return { purchase, replayed: false };
  };
  return opts.tx ? work(opts.tx) : idempotent(work, findPrev);
}

async function upsertSupplier(tx: Tx, ctx: StoreContext, name: string) {
  const [existing] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.storeId, ctx.storeId), sql`lower(${suppliers.name}) = lower(${name})`));
  if (existing) return existing.id;
  const [s] = await tx.insert(suppliers).values({ storeId: ctx.storeId, name }).returning({ id: suppliers.id });
  return s.id;
}

/** Physical count: records the difference between counted and recorded stock as count_correction movements. */
export async function recordCount(ctx: StoreContext, input: unknown) {
  const d = countSchema.parse(input);
  const findPrev = async () => {
    const prev = await getDb()
      .select()
      .from(inventoryTransactions)
      .where(and(eq(inventoryTransactions.storeId, ctx.storeId), eq(inventoryTransactions.idempotencyKey, d.idempotencyKey)));
    return prev.length ? { corrections: prev, unchanged: [] as string[], replayed: true } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;
  const seen = new Set<string>();
  for (const l of d.lines) {
    if (seen.has(l.productId)) throw new AppError("VALIDATION_ERROR", "Each product can appear only once in a count");
    seen.add(l.productId);
  }
  return idempotent(async (tx) => {
    const corrections = [];
    const unchanged: string[] = [];
    for (const l of d.lines) {
      // Lock first, then compute the difference against the locked value.
      await tx.execute(sql`insert into inventory_balances (product_id, store_id) select ${l.productId}, ${ctx.storeId} where exists (select 1 from products where id = ${l.productId} and store_id = ${ctx.storeId}) on conflict do nothing`);
      const r = await tx.execute<{ diff: string }>(sql`
        select (${toQty(l.countedQuantity)}::numeric - quantity)::text diff from inventory_balances
        where product_id = ${l.productId} and store_id = ${ctx.storeId} for update`);
      if (!r.rows[0]) throw notFound("Product");
      if (Number(r.rows[0].diff) === 0) {
        unchanged.push(l.productId);
        continue;
      }
      corrections.push(
        await applyMovement(tx, ctx, {
          productId: l.productId,
          type: "count_correction",
          delta: r.rows[0].diff,
          reason: d.note ?? "Physical count",
          referenceType: "count",
          idempotencyKey: d.idempotencyKey,
          allowNegative: true,
        }),
      );
    }
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "inventory.count", entityType: "inventory_count", after: { lines: d.lines, corrections: corrections.length }, ip: ctx.ip });
    return { corrections, unchanged, replayed: false };
  }, findPrev);
}

/** Opens packs: e.g. 1 box → 12 sachets. Two linked movements in one transaction. */
export async function recordRepack(ctx: StoreContext, input: unknown) {
  const d = repackSchema.parse(input);
  const findPrev = async () => {
    const prev = await getDb()
      .select()
      .from(inventoryTransactions)
      .where(and(eq(inventoryTransactions.storeId, ctx.storeId), eq(inventoryTransactions.idempotencyKey, d.idempotencyKey)));
    return prev.length ? { movements: prev, replayed: true } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;
  return idempotent(async (tx) => {
    const [pack] = await tx.select().from(products).where(and(eq(products.id, d.packProductId), eq(products.storeId, ctx.storeId)));
    if (!pack) throw notFound("Product");
    if (!pack.packChildId || !pack.packQuantity) throw new AppError("VALIDATION_ERROR", `"${pack.name}" is not set up as a pack of another product`);
    const childQty = d.packs * Number(pack.packQuantity);
    const out = await applyMovement(tx, ctx, { productId: pack.id, type: "repack_out", delta: -d.packs, reason: "Opened pack", referenceType: "repack", idempotencyKey: d.idempotencyKey });
    const inn = await applyMovement(tx, ctx, {
      productId: pack.packChildId,
      type: "repack_in",
      delta: childQty,
      reason: `From ${d.packs} × ${pack.name}`,
      referenceType: "repack",
      referenceId: out.id,
      idempotencyKey: d.idempotencyKey,
    });
    return { movements: [out, inn], replayed: false };
  }, findPrev);
}

export async function getProductHistory(ctx: StoreContext, productId: string, limit = 100) {
  const db = getDb();
  const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId)));
  if (!p) throw notFound("Product");
  const rows = await db.execute<{
    id: string; type: string; quantity_delta: string; balance_after: string; unit_cost_centavos: string | null; reason: string | null;
    reference_type: string | null; reference_id: string | null; created_at: Date; by: string | null;
  }>(sql`
    select t.id, t.type, t.quantity_delta::text, t.balance_after::text, t.unit_cost_centavos, t.reason, t.reference_type, t.reference_id, t.created_at, u.full_name by
    from inventory_transactions t left join users u on u.id = t.created_by
    where t.store_id = ${ctx.storeId} and t.product_id = ${productId}
    order by t.created_at desc, t.id desc limit ${limit}`);
  return rows.rows.map((r) => ({ ...r, unit_cost_centavos: r.unit_cost_centavos == null ? null : Number(r.unit_cost_centavos) }));
}

export async function listSuppliers(ctx: StoreContext) {
  return getDb().select().from(suppliers).where(and(eq(suppliers.storeId, ctx.storeId), sql`${suppliers.deletedAt} is null`)).orderBy(suppliers.name);
}

export async function listPurchases(ctx: StoreContext, limit = 50) {
  return getDb()
    .select({ id: purchases.id, referenceNo: purchases.referenceNo, purchaseDate: purchases.purchaseDate, totalCentavos: purchases.totalCentavos, supplier: suppliers.name, createdAt: purchases.createdAt })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.storeId, ctx.storeId))
    .orderBy(desc(purchases.createdAt))
    .limit(limit);
}

