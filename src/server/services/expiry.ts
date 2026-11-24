import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { productExpiries, products } from "@/db/schema";
import { AppError, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { readUpload, saveUpload, sniff } from "@/server/storage";
import { applyMovement, toQty } from "./inventory";
import type { StoreContext } from "./stores";
import { idempotencyKey, quantity } from "@/lib/validation-catalog";

export const EXPIRING_SOON_DAYS = 7;

const createSchema = z.object({
  productId: z.uuid(),
  expiryDate: z.iso.date("Enter the date printed on the label"),
  quantity: quantity.optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * Records a batch expiry. BOTH photos are required, in order: the product, then its label.
 * Photos must be images (not PDFs). Dates more than 1 year in the past are rejected as typos.
 */
export async function trackExpiry(ctx: StoreContext, input: unknown, photos: { product?: Buffer | null; label?: Buffer | null }) {
  const d = createSchema.parse(input);
  if (!photos.product?.length) throw new AppError("VALIDATION_ERROR", "Step 1: take a photo of the product", [{ path: "productPhoto", message: "Required" }]);
  if (!photos.label?.length) throw new AppError("VALIDATION_ERROR", "Step 2: take a photo of the expiry date label", [{ path: "labelPhoto", message: "Required" }]);
  for (const b of [photos.product, photos.label]) if (sniff(b).mime === "application/pdf") throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Use photos, not PDFs, for expiry tracking");
  if (new Date(d.expiryDate + "T00:00:00Z").getTime() < Date.now() - 366 * 864e5) throw new AppError("VALIDATION_ERROR", "That date is more than a year ago — check the label", [{ path: "expiryDate", message: "Check the date" }]);
  const [p] = await getDb().select({ id: products.id, name: products.name }).from(products).where(and(eq(products.id, d.productId), eq(products.storeId, ctx.storeId)));
  if (!p) throw notFound("Product");
  const prod = await saveUpload(ctx.storeId, "expiry", photos.product);
  const label = await saveUpload(ctx.storeId, "expiry", photos.label);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(productExpiries)
      .values({ storeId: ctx.storeId, productId: d.productId, expiryDate: d.expiryDate, quantity: d.quantity ? toQty(d.quantity) : null, productPhotoPath: prod.key, labelPhotoPath: label.key, note: d.note ?? null, createdBy: ctx.userId })
      .returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "expiry.track", entityType: "product_expiry", entityId: row.id, after: { product: p.name, expiryDate: d.expiryDate, quantity: d.quantity ?? null }, ip: ctx.ip });
    return row;
  });
}

export async function listExpiries(ctx: StoreContext, opts: { status?: "active" | "cleared" } = {}) {
  const r = await getDb().execute<{
    id: string; product_id: string; product_name: string; unit: string; stock: string; expiry_date: string; days_left: number; quantity: string | null;
    note: string | null; status: string; clear_reason: string | null; created_at: Date; by: string | null;
  }>(sql`
    select e.id, e.product_id, p.name product_name, p.unit, coalesce(b.quantity, 0)::text stock, e.expiry_date::text, e.quantity::text, e.note, e.status, e.clear_reason, e.created_at, u.full_name by,
      (e.expiry_date - (now() at time zone (select timezone from stores where id = ${ctx.storeId}))::date) as days_left
    from product_expiries e join products p on p.id = e.product_id left join inventory_balances b on b.product_id = e.product_id left join users u on u.id = e.created_by
    where e.store_id = ${ctx.storeId} and e.status = ${opts.status ?? "active"}
    order by e.expiry_date asc, p.name limit 500`);
  return r.rows.map((x) => ({ ...x, days_left: Number(x.days_left), quantity: x.quantity == null ? null : Number(x.quantity), stock: Number(x.stock) }));
}

/** Counts for dashboard/nav alerts. */
export async function expirySummary(ctx: StoreContext) {
  const r = await getDb().execute<{ expired: string; soon: string; month: string }>(sql`
    with t as (select (now() at time zone (select timezone from stores where id = ${ctx.storeId}))::date as today)
    select count(*) filter (where e.expiry_date < t.today) as expired,
      count(*) filter (where e.expiry_date >= t.today and e.expiry_date <= t.today + ${EXPIRING_SOON_DAYS}::int) as soon,
      count(*) filter (where e.expiry_date > t.today + ${EXPIRING_SOON_DAYS}::int and e.expiry_date <= t.today + 30) as month
    from product_expiries e, t where e.store_id = ${ctx.storeId} and e.status = 'active'`);
  const x = r.rows[0];
  return { expired: Number(x.expired), soon: Number(x.soon), month: Number(x.month) };
}

const clearSchema = z.object({
  reason: z.enum(["sold_out", "disposed", "returned"]),
  /** For "disposed": units removed from stock as expired (defaults to the batch quantity). */
  quantity: quantity.optional().nullable(),
  idempotencyKey,
});

/** Closes a batch. "disposed" also records an `expired` stock movement in the same transaction. */
export async function clearExpiry(ctx: StoreContext, expiryId: string, input: unknown) {
  const d = clearSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [e] = await tx.select().from(productExpiries).where(and(eq(productExpiries.id, expiryId), eq(productExpiries.storeId, ctx.storeId))).for("update");
    if (!e) throw notFound("Expiry record");
    if (e.status === "cleared") return { expiry: e, replayed: true };
    let txnId: string | null = null;
    if (d.reason === "disposed") {
      const q = d.quantity ?? (e.quantity ? Number(e.quantity) : null);
      if (!q) throw new AppError("VALIDATION_ERROR", "How many units are you throwing away?", [{ path: "quantity", message: "Enter a quantity" }]);
      const t = await applyMovement(tx, ctx, { productId: e.productId, type: "expired", delta: -q, reason: `Expired ${e.expiryDate}`, referenceType: "expiry", referenceId: e.id, idempotencyKey: d.idempotencyKey });
      txnId = t.id;
    }
    const [after] = await tx
      .update(productExpiries)
      .set({ status: "cleared", clearReason: d.reason, clearedBy: ctx.userId, clearedAt: new Date(), inventoryTransactionId: txnId })
      .where(eq(productExpiries.id, expiryId))
      .returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: `expiry.${d.reason}`, entityType: "product_expiry", entityId: expiryId, before: { status: e.status }, after: { status: "cleared", reason: d.reason, inventoryTransactionId: txnId }, ip: ctx.ip });
    return { expiry: after, replayed: false };
  });
}

export async function expiryPhoto(ctx: StoreContext, expiryId: string, kind: "product" | "label") {
  const [e] = await getDb().select().from(productExpiries).where(and(eq(productExpiries.id, expiryId), eq(productExpiries.storeId, ctx.storeId)));
  if (!e) throw notFound("Expiry record");
  const key = kind === "product" ? e.productPhotoPath : e.labelPhotoPath;
  const buffer = await readUpload(key);
  return { buffer, mimeType: sniff(buffer).mime };
}
