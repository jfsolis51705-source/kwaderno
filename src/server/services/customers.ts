import { and, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import { customerLedger, customers, payments } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { hasRole, type StoreContext } from "./stores";
import { customerPaymentSchema, customerSchema, customerUpdateSchema, listQuery } from "@/lib/validation-sales";

type LedgerType = (typeof customerLedger.$inferInsert)["entryType"];

/**
 * THE single way a customer's utang changes. Locks the customer row, updates the
 * running balance and appends an immutable ledger entry with balance_after.
 * Positive amount = customer owes more; negative = paid / reduced.
 */
export async function postLedger(
  tx: Tx,
  ctx: StoreContext,
  e: { customerId: string; type: LedgerType; amountCentavos: number; saleId?: string | null; paymentId?: string | null; note?: string | null; enforceLimit?: boolean },
) {
  const [c] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, e.customerId), eq(customers.storeId, ctx.storeId), sql`${customers.deletedAt} is null`))
    .for("update");
  if (!c) throw notFound("Customer");
  const next = c.balanceCentavos + e.amountCentavos;
  if (e.enforceLimit && c.creditLimitCentavos != null && e.amountCentavos > 0 && next > c.creditLimitCentavos) {
    throw new AppError("CONFLICT", `${c.name}'s utang would go over their limit of ₱${(c.creditLimitCentavos / 100).toFixed(2)}`, {
      field: "customerId",
      balanceCentavos: c.balanceCentavos,
      creditLimitCentavos: c.creditLimitCentavos,
    });
  }
  await tx.update(customers).set({ balanceCentavos: next }).where(eq(customers.id, c.id));
  const [entry] = await tx
    .insert(customerLedger)
    .values({
      storeId: ctx.storeId,
      customerId: c.id,
      entryType: e.type,
      amountCentavos: e.amountCentavos,
      balanceAfterCentavos: next,
      saleId: e.saleId ?? null,
      paymentId: e.paymentId ?? null,
      note: e.note ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  return { customer: { ...c, balanceCentavos: next }, entry };
}

export async function createCustomer(ctx: StoreContext, input: unknown) {
  const d = customerSchema.parse(input);
  if (d.creditLimitCentavos != null && !hasRole(ctx, "manager")) throw forbidden("Only owners and managers can set credit limits");
  return getDb().transaction(async (tx) => {
    const [c] = await tx
      .insert(customers)
      .values({ ...d, phone: d.phone ?? null, creditLimitCentavos: d.creditLimitCentavos ?? null, storeId: ctx.storeId, createdBy: ctx.userId })
      .returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "customer.create", entityType: "customer", entityId: c.id, after: c, ip: ctx.ip });
    return c;
  });
}

export async function updateCustomer(ctx: StoreContext, customerId: string, input: unknown) {
  const d = customerUpdateSchema.parse(input);
  if (d.creditLimitCentavos !== undefined && !hasRole(ctx, "manager")) throw forbidden("Only owners and managers can set credit limits");
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.storeId, ctx.storeId))).for("update");
    if (!before || before.deletedAt) throw notFound("Customer");
    // balance is never editable here — only through the ledger
    const [after] = await tx.update(customers).set(d).where(eq(customers.id, customerId)).returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "customer.update", entityType: "customer", entityId: customerId, before, after, ip: ctx.ip });
    return after;
  });
}

export async function listCustomers(ctx: StoreContext, query: unknown) {
  const q = listQuery.parse(query);
  const where = [sql`store_id = ${ctx.storeId}`, sql`deleted_at is null`];
  if (q.filter === "owing") where.push(sql`balance_centavos > 0`);
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push(sql`(name ilike ${like} or phone ilike ${like})`);
  }
  const cond = sql.join(where, sql` and `);
  const db = getDb();
  const [rows, agg] = await Promise.all([
    db.execute<{ id: string; name: string; phone: string | null; balance_centavos: string; credit_limit_centavos: string | null; last_activity: Date | null }>(sql`
      select c.id, c.name, c.phone, c.balance_centavos, c.credit_limit_centavos,
        (select max(created_at) from customer_ledger l where l.customer_id = c.id) last_activity
      from customers c where ${cond}
      order by (c.balance_centavos > 0) desc, lower(c.name) limit ${q.limit} offset ${q.offset}`),
    db.execute<{ n: string; owed: string }>(sql`select count(*) n, coalesce(sum(balance_centavos) filter (where balance_centavos > 0), 0) owed from customers where ${cond}`),
  ]);
  return {
    items: rows.rows.map((r) => ({ ...r, balance_centavos: Number(r.balance_centavos), credit_limit_centavos: r.credit_limit_centavos == null ? null : Number(r.credit_limit_centavos) })),
    total: Number(agg.rows[0].n),
    totalOwedCentavos: Number(agg.rows[0].owed),
  };
}

export async function getCustomer(ctx: StoreContext, customerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) throw notFound("Customer");
  const db = getDb();
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.storeId, ctx.storeId), sql`${customers.deletedAt} is null`));
  if (!c) throw notFound("Customer");
  const ledger = await db.execute<{
    id: string; entry_type: string; amount_centavos: string; balance_after_centavos: string; note: string | null; created_at: Date;
    sale_id: string | null; sale_no: number | null; payment_method: string | null; reference_no: string | null; by: string | null;
  }>(sql`
    select l.id, l.entry_type, l.amount_centavos, l.balance_after_centavos, l.note, l.created_at, l.sale_id, s.sale_no,
      p.method payment_method, p.reference_no, u.full_name by
    from customer_ledger l
    left join sales s on s.id = l.sale_id
    left join payments p on p.id = l.payment_id
    left join users u on u.id = l.created_by
    where l.customer_id = ${customerId} and l.store_id = ${ctx.storeId}
    order by l.created_at desc, l.id desc limit 200`);
  return {
    ...c,
    ledger: ledger.rows.map((r) => ({ ...r, amount_centavos: Number(r.amount_centavos), balance_after_centavos: Number(r.balance_after_centavos) })),
  };
}

/** Partial or full utang payment. Never edits history: adds a payment row and a negative ledger entry. */
export async function recordCustomerPayment(ctx: StoreContext, customerId: string, input: unknown) {
  const d = customerPaymentSchema.parse(input);
  const findPrev = async () => {
    const [p] = await getDb().select().from(payments).where(and(eq(payments.storeId, ctx.storeId), eq(payments.idempotencyKey, d.idempotencyKey)));
    return p ? { payment: p, balanceCentavos: null as number | null, replayed: true } : null;
  };
  const prev = await findPrev();
  if (prev) return prev;
  try {
    return await getDb().transaction(async (tx) => {
      const [c] = await tx
        .select({ balance: customers.balanceCentavos, name: customers.name })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.storeId, ctx.storeId), sql`${customers.deletedAt} is null`))
        .for("update");
      if (!c) throw notFound("Customer");
      if (c.balance <= 0) throw new AppError("CONFLICT", `${c.name} has no utang to pay`);
      if (d.amountCentavos > c.balance) {
        throw new AppError("VALIDATION_ERROR", `That is more than ${c.name} owes (₱${(c.balance / 100).toFixed(2)})`, [{ path: "amountCentavos", message: "More than the balance" }]);
      }
      const [payment] = await tx
        .insert(payments)
        .values({ storeId: ctx.storeId, customerId, method: d.method, amountCentavos: d.amountCentavos, referenceNo: d.referenceNo, idempotencyKey: d.idempotencyKey, receivedBy: ctx.userId })
        .returning();
      const { customer } = await postLedger(tx, ctx, { customerId, type: "payment", amountCentavos: -d.amountCentavos, paymentId: payment.id, note: d.note });
      await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "customer.payment", entityType: "payment", entityId: payment.id, after: payment, ip: ctx.ip });
      return { payment, balanceCentavos: customer.balanceCentavos, replayed: false };
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") {
      const p = await findPrev();
      if (p) return p;
    }
    throw e;
  }
}
