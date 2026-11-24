import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { payments, products, saleItems, sales } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { hasRole, type StoreContext } from "./stores";
import { applyMovement, toQty } from "./inventory";
import { postLedger } from "./customers";
import { listQuery, saleSchema, voidSaleSchema } from "@/lib/validation-sales";

const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Records a sale atomically:
 *   sale + sale_items (price/cost snapshot) → stock deduction per line (row-locked)
 *   → payment row (cash/GCash) or utang ledger entry (credit) → audit.
 * Any failure (e.g. not enough stock) rolls back everything.
 * Prices come from the catalog on the server; the client only sends product + quantity.
 */
export async function createSale(ctx: StoreContext, input: unknown) {
  const d = saleSchema.parse(input);
  if (d.discountCentavos > 0 && !hasRole(ctx, "manager")) throw forbidden("Only owners and managers can give discounts");
  if (d.occurredAt) {
    const t = new Date(d.occurredAt).getTime();
    if (t > Date.now() + 5 * 60 * 1000) throw new AppError("VALIDATION_ERROR", "Sale time is in the future");
    if (t < Date.now() - MAX_BACKDATE_MS) throw new AppError("VALIDATION_ERROR", "Sale is older than 30 days");
  }

  const findPrev = async () => {
    const [prev] = await getDb().select().from(sales).where(and(eq(sales.storeId, ctx.storeId), eq(sales.idempotencyKey, d.idempotencyKey)));
    return prev ? { ...(await getSale(ctx, prev.id)), replayed: true, changeCentavos: null as number | null } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;

  // Merge duplicate lines (same product scanned twice).
  const qtyByProduct = new Map<string, number>();
  for (const l of d.lines) qtyByProduct.set(l.productId, Math.round(((qtyByProduct.get(l.productId) ?? 0) + l.quantity) * 1000) / 1000);

  try {
    const saleId = await getDb().transaction(async (tx) => {
      const ids = [...qtyByProduct.keys()];
      const rows = await tx.select().from(products).where(and(eq(products.storeId, ctx.storeId), inArray(products.id, ids)));
      if (rows.length !== ids.length) throw notFound("Product");
      const lines = rows.map((p) => {
        if (p.archivedAt || !p.isActive) throw new AppError("CONFLICT", `"${p.name}" is archived and cannot be sold`);
        const q = qtyByProduct.get(p.id)!;
        return { p, q, lineTotal: Math.round(q * p.sellingPriceCentavos) };
      });
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      if (d.discountCentavos > subtotal) throw new AppError("VALIDATION_ERROR", "Discount is bigger than the total", [{ path: "discountCentavos", message: "Too large" }]);
      const total = subtotal - d.discountCentavos;
      if (d.paymentMethod === "cash" && d.amountTenderedCentavos != null && d.amountTenderedCentavos < total) {
        throw new AppError("VALIDATION_ERROR", "Cash received is less than the total", [{ path: "amountTenderedCentavos", message: "Not enough cash" }]);
      }
      if (d.customerId) {
        const c = await tx.execute(sql`select 1 from customers where id = ${d.customerId} and store_id = ${ctx.storeId} and deleted_at is null`);
        if (!c.rows.length) throw notFound("Customer");
      }

      const counter = await tx.execute<{ value: number }>(sql`
        insert into store_counters (store_id, name, value) values (${ctx.storeId}, 'sale', 1)
        on conflict (store_id, name) do update set value = store_counters.value + 1 returning value`);
      const [sale] = await tx
        .insert(sales)
        .values({
          storeId: ctx.storeId,
          saleNo: counter.rows[0].value,
          customerId: d.customerId ?? null,
          subtotalCentavos: subtotal,
          discountCentavos: d.discountCentavos,
          totalCentavos: total,
          paymentMethod: d.paymentMethod,
          amountTenderedCentavos: d.paymentMethod === "cash" ? (d.amountTenderedCentavos ?? total) : null,
          notes: d.notes,
          idempotencyKey: d.idempotencyKey,
          occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(),
          createdBy: ctx.userId,
        })
        .returning();

      // Lock balances in a stable order (by product id) to avoid deadlocks between concurrent carts.
      for (const l of [...lines].sort((a, b) => a.p.id.localeCompare(b.p.id))) {
        await tx.insert(saleItems).values({
          saleId: sale.id,
          storeId: ctx.storeId,
          productId: l.p.id,
          productName: l.p.name,
          quantity: toQty(l.q),
          unitPriceCentavos: l.p.sellingPriceCentavos,
          unitCostCentavos: l.p.purchaseCostCentavos,
          lineTotalCentavos: l.lineTotal,
        });
        await applyMovement(tx, ctx, { productId: l.p.id, type: "sale", delta: -l.q, unitCostCentavos: l.p.purchaseCostCentavos, reason: `Sale #${sale.saleNo}`, referenceType: "sale", referenceId: sale.id });
      }

      if (d.paymentMethod === "credit") {
        if (total > 0) await postLedger(tx, ctx, { customerId: d.customerId!, type: "credit_sale", amountCentavos: total, saleId: sale.id, note: `Sale #${sale.saleNo}`, enforceLimit: true });
      } else if (total > 0) {
        await tx.insert(payments).values({
          storeId: ctx.storeId,
          saleId: sale.id,
          customerId: d.customerId ?? null,
          method: d.paymentMethod,
          amountCentavos: total,
          referenceNo: d.paymentMethod === "gcash" ? d.referenceNo : null,
          receivedBy: ctx.userId,
        });
      }
      await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "sale.create", entityType: "sale", entityId: sale.id, after: { saleNo: sale.saleNo, total, method: d.paymentMethod, lines: lines.length }, ip: ctx.ip });
      return sale.id;
    });
    const sale = await getSale(ctx, saleId);
    const change = sale.paymentMethod === "cash" && sale.amountTenderedCentavos != null ? sale.amountTenderedCentavos - sale.totalCentavos : null;
    return { ...sale, changeCentavos: change, replayed: false };
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") {
      const p = await findPrev();
      if (p) return p;
    }
    throw e;
  }
}

export async function getSale(ctx: StoreContext, saleId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) throw notFound("Sale");
  const db = getDb();
  const r = await db.execute<{
    id: string; sale_no: number; status: string; payment_method: "cash" | "gcash" | "credit"; subtotal_centavos: string; discount_centavos: string;
    total_centavos: string; amount_tendered_centavos: string | null; occurred_at: Date; notes: string | null; void_reason: string | null; voided_at: Date | null;
    customer_id: string | null; customer_name: string | null; cashier: string | null; store_name: string;
  }>(sql`
    select s.id, s.sale_no, s.status, s.payment_method, s.subtotal_centavos, s.discount_centavos, s.total_centavos, s.amount_tendered_centavos,
      s.occurred_at, s.notes, s.void_reason, s.voided_at, s.customer_id, c.name customer_name, u.full_name cashier, st.name store_name
    from sales s left join customers c on c.id = s.customer_id left join users u on u.id = s.created_by join stores st on st.id = s.store_id
    where s.id = ${saleId} and s.store_id = ${ctx.storeId}`);
  const s = r.rows[0];
  if (!s) throw notFound("Sale");
  const [items, pays] = await Promise.all([
    db.select().from(saleItems).where(eq(saleItems.saleId, saleId)),
    db.select({ method: payments.method, amountCentavos: payments.amountCentavos, referenceNo: payments.referenceNo }).from(payments).where(eq(payments.saleId, saleId)),
  ]);
  return {
    id: s.id,
    saleNo: s.sale_no,
    status: s.status,
    paymentMethod: s.payment_method,
    subtotalCentavos: Number(s.subtotal_centavos),
    discountCentavos: Number(s.discount_centavos),
    totalCentavos: Number(s.total_centavos),
    amountTenderedCentavos: s.amount_tendered_centavos == null ? null : Number(s.amount_tendered_centavos),
    occurredAt: s.occurred_at,
    notes: s.notes,
    voidedAt: s.voided_at,
    voidReason: s.void_reason,
    customer: s.customer_id ? { id: s.customer_id, name: s.customer_name } : null,
    cashier: s.cashier,
    storeName: s.store_name,
    items: items.map((i) => ({ productId: i.productId, name: i.productName, quantity: i.quantity, unitPriceCentavos: i.unitPriceCentavos, lineTotalCentavos: i.lineTotalCentavos })),
    payments: pays,
  };
}
export type SaleDetail = Awaited<ReturnType<typeof getSale>>;

export async function listSales(ctx: StoreContext, query: unknown) {
  const q = listQuery.parse(query);
  const where = [sql`s.store_id = ${ctx.storeId}`];
  const tz = sql`(select timezone from stores where id = ${ctx.storeId})`;
  if (q.from) where.push(sql`s.occurred_at >= (${q.from}::date)::timestamp at time zone ${tz}`);
  if (q.to) where.push(sql`s.occurred_at < ((${q.to}::date + 1))::timestamp at time zone ${tz}`);
  if (q.q && /^\d+$/.test(q.q)) where.push(sql`s.sale_no = ${Number(q.q)}`);
  const cond = sql.join(where, sql` and `);
  const db = getDb();
  const [rows, agg] = await Promise.all([
    db.execute<{ id: string; sale_no: number; status: string; payment_method: string; total_centavos: string; occurred_at: Date; customer: string | null; items: string; cashier: string | null }>(sql`
      select s.id, s.sale_no, s.status, s.payment_method, s.total_centavos, s.occurred_at, c.name customer, u.full_name cashier,
        (select count(*) from sale_items si where si.sale_id = s.id) items
      from sales s left join customers c on c.id = s.customer_id left join users u on u.id = s.created_by
      where ${cond} order by s.occurred_at desc limit ${q.limit} offset ${q.offset}`),
    db.execute<{ n: string; total: string }>(sql`select count(*) n, coalesce(sum(total_centavos) filter (where status='completed'),0) total from sales s where ${cond}`),
  ]);
  return {
    items: rows.rows.map((r) => ({ ...r, total_centavos: Number(r.total_centavos), items: Number(r.items) })),
    total: Number(agg.rows[0].n),
    completedTotalCentavos: Number(agg.rows[0].total),
  };
}

/** Voids a sale: returns stock and reverses utang. Payment rows are kept for audit. Manager+. */
export async function voidSale(ctx: StoreContext, saleId: string, input: unknown) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can void sales");
  const { reason } = voidSaleSchema.parse(input);
  await getDb().transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.storeId, ctx.storeId))).for("update");
    if (!s) throw notFound("Sale");
    if (s.status === "voided") throw new AppError("CONFLICT", "This sale is already voided");
    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));
    for (const i of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      await applyMovement(tx, ctx, { productId: i.productId, type: "sale_void", delta: i.quantity, reason: `Void of sale #${s.saleNo}: ${reason}`, referenceType: "sale", referenceId: s.id, allowNegative: true });
    }
    if (s.paymentMethod === "credit" && s.customerId && s.totalCentavos > 0) {
      await postLedger(tx, ctx, { customerId: s.customerId, type: "sale_void", amountCentavos: -s.totalCentavos, saleId: s.id, note: `Void of sale #${s.saleNo}` });
    }
    await tx.update(sales).set({ status: "voided", voidedAt: new Date(), voidedBy: ctx.userId, voidReason: reason }).where(eq(sales.id, saleId));
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "sale.void", entityType: "sale", entityId: saleId, before: { status: s.status }, after: { status: "voided", reason }, ip: ctx.ip });
  });
  return getSale(ctx, saleId);
}
