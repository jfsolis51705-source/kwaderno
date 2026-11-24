import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import { categories, productBarcodes, products } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { hasRole, type StoreContext } from "./stores";
import { applyMovement, toQty } from "./inventory";
import { barcodeValue, categorySchema, productListQuery, productSchema, productUpdateSchema } from "@/lib/validation-catalog";
import { randomUUID } from "node:crypto";

const withTx = <T>(outer: Tx | undefined, fn: (tx: Tx) => Promise<T>) => (outer ? fn(outer) : getDb().transaction(fn));

export async function listCategories(ctx: StoreContext) {
  return getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.storeId, ctx.storeId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.name));
}

async function ensureCategory(tx: Tx, ctx: StoreContext, name: string) {
  // Case-insensitive unique index: insert-or-ignore, then read back (restoring a soft-deleted category).
  await tx.execute(sql`insert into categories (store_id, name) values (${ctx.storeId}, ${name}) on conflict (store_id, lower(name)) do update set deleted_at = null`);
  const [c] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.storeId, ctx.storeId), sql`lower(${categories.name}) = lower(${name})`));
  return c.id;
}

export async function createCategory(ctx: StoreContext, input: unknown) {
  const d = categorySchema.parse(input);
  return getDb().transaction(async (tx) => ({ id: await ensureCategory(tx, ctx, d.name), name: d.name }));
}

async function assertBarcodeFree(tx: Tx, ctx: StoreContext, code: string) {
  const [taken] = await tx
    .select({ productId: productBarcodes.productId, name: products.name })
    .from(productBarcodes)
    .innerJoin(products, eq(products.id, productBarcodes.productId))
    .where(and(eq(productBarcodes.storeId, ctx.storeId), eq(productBarcodes.barcode, code)));
  if (taken) throw new AppError("CONFLICT", `Barcode ${code} is already used by "${taken.name}"`, { field: "barcode", productId: taken.productId });
}

async function resolvePackChild(tx: Tx, ctx: StoreContext, packChildId: string | null | undefined, selfId?: string) {
  if (!packChildId) return;
  if (packChildId === selfId) throw new AppError("VALIDATION_ERROR", "A product cannot be a pack of itself", { field: "packChildId" });
  const [c] = await tx.select({ id: products.id, packChildId: products.packChildId }).from(products).where(and(eq(products.id, packChildId), eq(products.storeId, ctx.storeId)));
  if (!c) throw new AppError("VALIDATION_ERROR", "The contained product was not found", { field: "packChildId" });
  if (selfId && c.packChildId === selfId) throw new AppError("VALIDATION_ERROR", "Packs cannot contain each other", { field: "packChildId" });
}

/** Runs in the caller's transaction when one is given (e.g. receipt confirmation). */
export async function createProduct(ctx: StoreContext, input: unknown, outerTx?: Tx) {
  const d = productSchema.parse(input);
  if ((d.packChildId == null) !== (d.packQuantity == null)) throw new AppError("VALIDATION_ERROR", "Choose the contained product and how many are in one pack", { field: "packQuantity" });
  const codes = [...new Set(d.barcodes ?? [])];
  return withTx(outerTx, async (tx) => {
    for (const c of codes) await assertBarcodeFree(tx, ctx, c);
    await resolvePackChild(tx, ctx, d.packChildId);
    let categoryId = d.categoryId ?? null;
    if (categoryId) {
      const [c] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.storeId, ctx.storeId)));
      if (!c) throw new AppError("VALIDATION_ERROR", "Category not found", { field: "categoryId" });
    } else if (d.categoryName) categoryId = await ensureCategory(tx, ctx, d.categoryName);

    const [p] = await tx
      .insert(products)
      .values({
        storeId: ctx.storeId,
        name: d.name,
        sku: d.sku,
        brand: d.brand,
        categoryId,
        unit: d.unit,
        packagingDescription: d.packagingDescription,
        purchaseCostCentavos: d.purchaseCostCentavos,
        sellingPriceCentavos: d.sellingPriceCentavos,
        reorderThreshold: toQty(d.reorderThreshold),
        packChildId: d.packChildId ?? null,
        packQuantity: d.packQuantity != null ? toQty(d.packQuantity) : null,
        isActive: d.isActive ?? true,
        createdBy: ctx.userId,
      })
      .returning();
    for (const c of codes) await tx.insert(productBarcodes).values({ storeId: ctx.storeId, productId: p.id, barcode: c });
    await tx.execute(sql`insert into inventory_balances (product_id, store_id) values (${p.id}, ${ctx.storeId})`);
    if (d.openingQuantity && d.openingQuantity > 0) {
      await applyMovement(tx, ctx, {
        productId: p.id,
        type: "opening",
        delta: d.openingQuantity,
        unitCostCentavos: d.purchaseCostCentavos,
        reason: "Opening stock when product was added",
        referenceType: "product",
        referenceId: p.id,
        idempotencyKey: `opening:${p.id}:${randomUUID()}`,
      });
    }
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "product.create", entityType: "product", entityId: p.id, after: { ...p, barcodes: codes }, ip: ctx.ip });
    return p;
  });
}

export async function updateProduct(ctx: StoreContext, productId: string, input: unknown) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can edit products");
  const d = productUpdateSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId))).for("update");
    if (!before) throw notFound("Product");
    if (d.packChildId !== undefined) await resolvePackChild(tx, ctx, d.packChildId, productId);
    const { categoryName, reorderThreshold, packQuantity, ...rest } = d;
    let categoryId = rest.categoryId;
    if (categoryId) {
      const [c] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.storeId, ctx.storeId)));
      if (!c) throw new AppError("VALIDATION_ERROR", "Category not found", { field: "categoryId" });
    } else if (categoryName) categoryId = await ensureCategory(tx, ctx, categoryName);
    const set = {
      ...rest,
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(reorderThreshold !== undefined ? { reorderThreshold: toQty(reorderThreshold) } : {}),
      ...(packQuantity !== undefined ? { packQuantity: packQuantity == null ? null : toQty(packQuantity) } : {}),
    };
    const nextChild = set.packChildId !== undefined ? set.packChildId : before.packChildId;
    const nextQty = set.packQuantity !== undefined ? set.packQuantity : before.packQuantity;
    if ((nextChild == null) !== (nextQty == null)) throw new AppError("VALIDATION_ERROR", "Choose the contained product and how many are in one pack", { field: "packQuantity" });
    const [after] = await tx.update(products).set(set).where(eq(products.id, productId)).returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "product.update", entityType: "product", entityId: productId, before, after, ip: ctx.ip });
    return after;
  });
}

/** Archive hides a product from selling and stock-in but keeps its full history. */
export async function setArchived(ctx: StoreContext, productId: string, archived: boolean) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can archive products");
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId))).for("update");
    if (!before) throw notFound("Product");
    const [after] = await tx
      .update(products)
      .set({ archivedAt: archived ? new Date() : null, isActive: !archived })
      .where(eq(products.id, productId))
      .returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: archived ? "product.archive" : "product.restore", entityType: "product", entityId: productId, before, after, ip: ctx.ip });
    return after;
  });
}

const PRODUCT_COLUMNS = sql`
  p.id, p.name, p.sku, p.brand, p.unit, p.packaging_description, p.purchase_cost_centavos, p.selling_price_centavos,
  p.reorder_threshold::text, p.is_active, p.archived_at, p.image_path, p.category_id, c.name category,
  p.pack_child_id, p.pack_quantity::text, child.name pack_child_name, child.unit pack_child_unit,
  coalesce(b.quantity, 0)::text quantity,
  coalesce((select array_agg(pb.barcode order by pb.created_at) from product_barcodes pb where pb.product_id = p.id), '{}') barcodes`;
const PRODUCT_FROM = sql`
  from products p
  left join categories c on c.id = p.category_id
  left join products child on child.id = p.pack_child_id
  left join inventory_balances b on b.product_id = p.id`;

export type ProductRow = {
  id: string; name: string; sku: string | null; brand: string | null; unit: string; packaging_description: string | null;
  purchase_cost_centavos: number; selling_price_centavos: number; reorder_threshold: string; is_active: boolean; archived_at: Date | null;
  image_path: string | null; category_id: string | null; category: string | null; pack_child_id: string | null; pack_quantity: string | null;
  pack_child_name: string | null; pack_child_unit: string | null; quantity: string; barcodes: string[];
};
const normalize = (r: ProductRow): ProductRow => ({ ...r, purchase_cost_centavos: Number(r.purchase_cost_centavos), selling_price_centavos: Number(r.selling_price_centavos) });

export async function listProducts(ctx: StoreContext, query: unknown) {
  const q = productListQuery.parse(query);
  const where = [sql`p.store_id = ${ctx.storeId}`];
  where.push(q.filter === "archived" ? sql`p.archived_at is not null` : sql`p.archived_at is null`);
  if (q.filter === "low") where.push(sql`coalesce(b.quantity,0) <= p.reorder_threshold`);
  if (q.filter === "out") where.push(sql`coalesce(b.quantity,0) <= 0`);
  if (q.categoryId) where.push(sql`p.category_id = ${q.categoryId}`);
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push(sql`(p.name ilike ${like} or p.brand ilike ${like} or p.sku ilike ${like} or exists (select 1 from product_barcodes pb where pb.product_id = p.id and pb.barcode = ${q.q}))`);
  }
  const cond = sql.join(where, sql` and `);
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.execute<ProductRow>(sql`select ${PRODUCT_COLUMNS} ${PRODUCT_FROM} where ${cond} order by lower(p.name) limit ${q.limit} offset ${q.offset}`),
    db.execute<{ n: string }>(sql`select count(*) n ${PRODUCT_FROM} where ${cond}`),
  ]);
  return { items: rows.rows.map(normalize), total: Number(total.rows[0].n), limit: q.limit, offset: q.offset };
}

export async function getProduct(ctx: StoreContext, productId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) throw notFound("Product");
  const r = await getDb().execute<ProductRow>(sql`select ${PRODUCT_COLUMNS} ${PRODUCT_FROM} where p.id = ${productId} and p.store_id = ${ctx.storeId}`);
  if (!r.rows[0]) throw notFound("Product");
  const packs = await getDb().execute<{ id: string; name: string; pack_quantity: string }>(
    sql`select id, name, pack_quantity::text from products where pack_child_id = ${productId} and store_id = ${ctx.storeId} and archived_at is null`,
  );
  return { ...normalize(r.rows[0]), packsOfThis: packs.rows };
}

/** Workflow A/E: exact barcode lookup within the store. Returns null (not 404) when unknown so the UI can offer registration. */
export async function lookupBarcode(ctx: StoreContext, code: string) {
  const c = barcodeValue.parse(code);
  const r = await getDb().execute<ProductRow>(
    sql`select ${PRODUCT_COLUMNS} ${PRODUCT_FROM} join product_barcodes hit on hit.product_id = p.id where hit.store_id = ${ctx.storeId} and hit.barcode = ${c}`,
  );
  return r.rows[0] ? normalize(r.rows[0]) : null;
}

export async function addBarcode(ctx: StoreContext, productId: string, input: unknown) {
  const { barcode, symbology } = (input ?? {}) as { barcode?: unknown; symbology?: unknown };
  const code = barcodeValue.parse(barcode);
  return getDb().transaction(async (tx) => {
    const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId)));
    if (!p) throw notFound("Product");
    await assertBarcodeFree(tx, ctx, code);
    const [row] = await tx
      .insert(productBarcodes)
      .values({ storeId: ctx.storeId, productId, barcode: code, symbology: typeof symbology === "string" ? symbology.slice(0, 30) : null })
      .returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "barcode.add", entityType: "product", entityId: productId, after: row, ip: ctx.ip });
    return row;
  });
}

export async function removeBarcode(ctx: StoreContext, productId: string, barcode: string) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can remove barcodes");
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(productBarcodes)
      .where(and(eq(productBarcodes.storeId, ctx.storeId), eq(productBarcodes.productId, productId), eq(productBarcodes.barcode, barcode)))
      .returning();
    if (!row) throw notFound("Barcode");
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "barcode.remove", entityType: "product", entityId: productId, before: row, ip: ctx.ip });
  });
}
