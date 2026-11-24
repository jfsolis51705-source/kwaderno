import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { products, purchases, receiptItems, receipts } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { readUpload, saveUpload } from "@/server/storage";
import { bestMatch } from "@/server/ai/match";
import { httpExtractor, type Extractor } from "@/server/ai/extractor";
import { createProduct } from "./catalog";
import { recordStockIn, toQty } from "./inventory";
import { hasRole, type StoreContext } from "./stores";
import { centavos, idempotencyKey, quantity } from "@/lib/validation-catalog";

const STALE_PROCESSING_MS = 5 * 60 * 1000;

/** Step 1–3: store the original file and create the processing record. Inventory is NOT touched. */
export async function uploadReceipt(ctx: StoreContext, file: { buffer: Buffer; filename?: string }) {
  const saved = await saveUpload(ctx.storeId, "receipts", file.buffer);
  const db = getDb();
  const [dup] = await db
    .select({ id: receipts.id, status: receipts.status, createdAt: receipts.createdAt })
    .from(receipts)
    .where(and(eq(receipts.storeId, ctx.storeId), eq(receipts.sha256, saved.sha256), sql`${receipts.status} <> 'rejected'`))
    .orderBy(desc(receipts.createdAt))
    .limit(1);
  const [r] = await db
    .insert(receipts)
    .values({ storeId: ctx.storeId, uploadedBy: ctx.userId, filePath: saved.key, mimeType: saved.mime, fileSize: saved.size, sha256: saved.sha256, status: "queued" })
    .returning();
  await writeAudit(db, { storeId: ctx.storeId, userId: ctx.userId, action: "receipt.upload", entityType: "receipt", entityId: r.id, after: { mime: saved.mime, size: saved.size, duplicateOf: dup?.id ?? null }, ip: ctx.ip });
  // Same photo uploaded before: allowed (it may be a re-take), but the UI warns and confirmation of both is blocked below.
  return { receipt: r, duplicateOf: dup ? { id: dup.id, status: dup.status } : null };
}

/**
 * Steps 4–9: OCR/AI extraction, product matching and confidence scoring.
 * Safe to call repeatedly: claims the receipt atomically (queued/failed/stale → processing).
 */
export async function processReceipt(storeId: string, receiptId: string, extractor: Extractor = httpExtractor) {
  const db = getDb();
  const claimed = await db.execute<{ id: string; file_path: string; mime_type: string }>(sql`
    update receipts set status = 'processing', attempts = attempts + 1, error_message = null, updated_at = now()
    where id = ${receiptId} and store_id = ${storeId}
      and (status in ('queued','failed') or (status = 'processing' and updated_at < now() - ${`${STALE_PROCESSING_MS / 1000} seconds`}::interval))
    returning id, file_path, mime_type`);
  const r = claimed.rows[0];
  if (!r) return { processed: false };
  try {
    const buffer = await readUpload(r.file_path);
    const ext = await extractor({ buffer, mimeType: r.mime_type, filename: r.file_path.split("/").pop()! });
    const catalog = await db
      .select({ id: products.id, name: products.name, brand: products.brand })
      .from(products)
      .where(and(eq(products.storeId, storeId), sql`${products.archivedAt} is null`));
    await db.transaction(async (tx) => {
      await tx.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
      for (const [i, line] of ext.lines.entries()) {
        const m = bestMatch(line.description, catalog);
        const unit = line.unitPriceCentavos ?? (line.lineTotalCentavos != null && line.quantity ? Math.round(line.lineTotalCentavos / line.quantity) : null);
        await tx.insert(receiptItems).values({
          receiptId,
          storeId,
          lineNo: i + 1,
          rawDescription: line.description,
          extractedQuantity: line.quantity != null ? toQty(line.quantity) : null,
          extractedUnitPriceCentavos: line.unitPriceCentavos ?? null,
          extractedLineTotalCentavos: line.lineTotalCentavos ?? null,
          confidence: line.confidence != null ? line.confidence.toFixed(3) : null,
          suggestedProductId: m?.product.id ?? null,
          matchConfidence: m ? m.score.toFixed(3) : null,
          // Pre-filled review values — still require merchant confirmation.
          action: m ? "match" : "create",
          productId: m?.product.id ?? null,
          quantity: line.quantity != null ? toQty(line.quantity) : null,
          unitCostCentavos: unit,
        });
      }
      await tx
        .update(receipts)
        .set({
          status: "pending_review",
          provider: ext.provider,
          rawExtraction: ext as unknown as object, // original output preserved, never edited
          supplierName: ext.supplierName ?? null,
          receiptNumber: ext.receiptNumber ?? null,
          purchaseDate: ext.purchaseDate ?? null,
          discountCentavos: ext.discountCentavos ?? null,
          taxCentavos: ext.taxCentavos ?? null,
          grandTotalCentavos: ext.grandTotalCentavos ?? null,
          overallConfidence: ext.overallConfidence != null ? ext.overallConfidence.toFixed(3) : null,
        })
        .where(eq(receipts.id, receiptId));
    });
    return { processed: true };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Could not read this receipt. Try a clearer photo or enter the items manually.";
    if (!(e instanceof AppError)) console.error("[kwaderno] receipt processing failed", e);
    await db.update(receipts).set({ status: "failed", errorMessage: msg }).where(eq(receipts.id, receiptId));
    return { processed: false, error: msg };
  }
}

export async function listReceipts(ctx: StoreContext, limit = 50) {
  return getDb()
    .select({
      id: receipts.id, status: receipts.status, supplierName: receipts.supplierName, receiptNumber: receipts.receiptNumber,
      grandTotalCentavos: receipts.grandTotalCentavos, createdAt: receipts.createdAt, mimeType: receipts.mimeType,
      items: sql<number>`(select count(*)::int from receipt_items ri where ri.receipt_id = ${receipts.id})`,
      errorMessage: receipts.errorMessage,
    })
    .from(receipts)
    .where(eq(receipts.storeId, ctx.storeId))
    .orderBy(desc(receipts.createdAt))
    .limit(limit);
}

export async function getReceipt(ctx: StoreContext, receiptId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) throw notFound("Receipt");
  const db = getDb();
  const [r] = await db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.storeId, ctx.storeId)));
  if (!r) throw notFound("Receipt");
  const items = await db.execute<{
    id: string; line_no: number; raw_description: string; extracted_quantity: string | null; extracted_unit_price_centavos: string | null;
    extracted_line_total_centavos: string | null; confidence: string | null; suggested_product_id: string | null; match_confidence: string | null;
    action: "match" | "create" | "skip" | null; product_id: string | null; quantity: string | null; unit_cost_centavos: string | null;
    product_name: string | null; product_unit: string | null; product_stock: string | null;
  }>(sql`
    select ri.*, p.name product_name, p.unit product_unit, coalesce(b.quantity, 0)::text product_stock
    from receipt_items ri left join products p on p.id = ri.product_id left join inventory_balances b on b.product_id = ri.product_id
    where ri.receipt_id = ${receiptId} order by ri.line_no`);
  const [dup] = await db
    .select({ id: receipts.id, status: receipts.status })
    .from(receipts)
    .where(and(eq(receipts.storeId, ctx.storeId), eq(receipts.sha256, r.sha256), sql`${receipts.id} <> ${receiptId}`, sql`${receipts.status} <> 'rejected'`))
    .limit(1);
  const [purchase] = await db.select({ id: purchases.id, totalCentavos: purchases.totalCentavos }).from(purchases).where(eq(purchases.receiptId, receiptId));
  const n = (v: string | null) => (v == null ? null : Number(v));
  return {
    ...r,
    duplicateOf: dup ?? null,
    purchase: purchase ?? null,
    items: items.rows.map((i) => ({
      id: i.id, lineNo: i.line_no, rawDescription: i.raw_description,
      extracted: { quantity: n(i.extracted_quantity), unitPriceCentavos: n(i.extracted_unit_price_centavos), lineTotalCentavos: n(i.extracted_line_total_centavos), confidence: n(i.confidence) },
      suggestedProductId: i.suggested_product_id, matchConfidence: n(i.match_confidence),
      action: i.action, productId: i.product_id, productName: i.product_name, productUnit: i.product_unit, productStock: n(i.product_stock),
      quantity: n(i.quantity), unitCostCentavos: n(i.unit_cost_centavos),
    })),
  };
}
export type ReceiptDetail = Awaited<ReturnType<typeof getReceipt>>;

export async function receiptFile(ctx: StoreContext, receiptId: string) {
  const [r] = await getDb().select({ filePath: receipts.filePath, mimeType: receipts.mimeType }).from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.storeId, ctx.storeId)));
  if (!r) throw notFound("Receipt");
  return { buffer: await readUpload(r.filePath), mimeType: r.mimeType };
}

/** Manual retry (or first run when the AI was down). */
export async function retryReceipt(ctx: StoreContext, receiptId: string) {
  const [r] = await getDb().select({ status: receipts.status }).from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.storeId, ctx.storeId)));
  if (!r) throw notFound("Receipt");
  if (!["failed", "queued", "processing"].includes(r.status)) throw new AppError("CONFLICT", `Receipt is already ${r.status.replace("_", " ")}`);
  await getDb().update(receipts).set({ status: "queued" }).where(and(eq(receipts.id, receiptId), sql`${receipts.status} = 'failed'`));
}

const reviewLine = z.object({
  id: z.uuid().optional(), // absent = line added manually by the merchant
  rawDescription: z.string().trim().min(1).max(300),
  action: z.enum(["match", "create", "skip"]),
  productId: z.uuid().nullish(),
  quantity: quantity.nullish(),
  unitCostCentavos: centavos.nullish(),
  newProduct: z
    .object({ name: z.string().trim().min(1).max(160), unit: z.string().trim().min(1).max(20).default("pc"), sellingPriceCentavos: centavos, categoryName: z.string().trim().max(60).nullish() })
    .nullish(),
});
export const confirmSchema = z.object({
  idempotencyKey,
  supplierName: z.string().trim().max(120).nullish(),
  receiptNumber: z.string().trim().max(60).nullish(),
  purchaseDate: z.iso.date().nullish(),
  updateProductCost: z.boolean().default(true),
  lines: z.array(reviewLine).min(1).max(300),
});

function validateLines(lines: z.infer<typeof reviewLine>[]) {
  const errors: { path: string; message: string }[] = [];
  lines.forEach((l, i) => {
    if (l.action === "skip") return;
    if (!(l.quantity && l.quantity > 0)) errors.push({ path: `lines.${i}.quantity`, message: "Enter a quantity" });
    if (l.unitCostCentavos == null) errors.push({ path: `lines.${i}.unitCostCentavos`, message: "Enter the unit cost" });
    if (l.action === "match" && !l.productId) errors.push({ path: `lines.${i}.productId`, message: "Choose the product" });
    if (l.action === "create" && !l.newProduct) errors.push({ path: `lines.${i}.newProduct`, message: "Enter the new product details" });
  });
  if (!lines.some((l) => l.action !== "skip")) errors.push({ path: "lines", message: "Keep at least one item" });
  if (errors.length) throw new AppError("VALIDATION_ERROR", "Please check the highlighted items", errors);
}

/**
 * Steps 10–15: merchant-reviewed values → new products (if any) → one purchase with
 * stock-in movements → receipt confirmed. All in one transaction. The unique index on
 * purchases.receipt_id guarantees a receipt can never be applied twice.
 */
export async function confirmReceipt(ctx: StoreContext, receiptId: string, input: unknown) {
  const d = confirmSchema.parse(input);
  if (d.lines.some((l) => l.action === "create") && !hasRole(ctx, "staff")) throw forbidden();
  validateLines(d.lines);
  const replay = async () => {
    const [p] = await getDb().select().from(purchases).where(and(eq(purchases.storeId, ctx.storeId), eq(purchases.receiptId, receiptId)));
    return p ? { purchaseId: p.id, replayed: true } : null;
  };
  try {
    return await getDb().transaction(async (tx) => {
      const [r] = await tx.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.storeId, ctx.storeId))).for("update");
      if (!r) throw notFound("Receipt");
      if (r.status === "confirmed") {
        const [p] = await tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.receiptId, receiptId));
        return { purchaseId: p?.id ?? null, replayed: true };
      }
      if (!["pending_review", "failed", "queued"].includes(r.status)) throw new AppError("CONFLICT", `This receipt is ${r.status.replace("_", " ")} and cannot be confirmed`);
      const [dupConfirmed] = await tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(and(eq(receipts.storeId, ctx.storeId), eq(receipts.sha256, r.sha256), eq(receipts.status, "confirmed"), sql`${receipts.id} <> ${receiptId}`));
      if (dupConfirmed) throw new AppError("CONFLICT", "This same receipt photo was already confirmed. Reject this copy instead.", { duplicateOf: dupConfirmed.id });

      const existing = await tx.select({ id: receiptItems.id, lineNo: receiptItems.lineNo }).from(receiptItems).where(eq(receiptItems.receiptId, receiptId)).orderBy(asc(receiptItems.lineNo));
      const known = new Set(existing.map((e) => e.id));
      let nextLine = (existing.at(-1)?.lineNo ?? 0) + 1;
      const stockLines: { productId: string; quantity: number; unitCostCentavos: number }[] = [];
      const stockItemIds: string[] = [];
      for (const l of d.lines) {
        if (l.id && !known.has(l.id)) throw notFound("Receipt line");
        let itemId = l.id;
        if (!itemId) {
          const [ins] = await tx.insert(receiptItems).values({ receiptId, storeId: ctx.storeId, lineNo: nextLine++, rawDescription: l.rawDescription }).returning({ id: receiptItems.id });
          itemId = ins.id;
        }
        let productId = l.productId ?? null;
        if (l.action === "create") {
          const p = await createProduct(ctx, { ...l.newProduct, purchaseCostCentavos: l.unitCostCentavos ?? 0 }, tx);
          productId = p.id;
        } else if (l.action === "match") {
          const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, productId!), eq(products.storeId, ctx.storeId)));
          if (!p) throw notFound("Product");
        }
        await tx
          .update(receiptItems)
          .set({
            action: l.action,
            productId: l.action === "skip" ? null : productId,
            quantity: l.quantity != null ? toQty(l.quantity) : null,
            unitCostCentavos: l.unitCostCentavos ?? null,
            reviewedBy: ctx.userId,
            reviewedAt: new Date(),
          })
          .where(eq(receiptItems.id, itemId));
        if (l.action !== "skip") {
          stockLines.push({ productId: productId!, quantity: l.quantity!, unitCostCentavos: l.unitCostCentavos! });
          stockItemIds.push(itemId);
        }
      }
      const { purchase } = await recordStockIn(
        ctx,
        {
          supplierName: d.supplierName ?? r.supplierName ?? null,
          referenceNo: d.receiptNumber ?? r.receiptNumber ?? null,
          purchaseDate: d.purchaseDate ?? r.purchaseDate ?? undefined,
          updateProductCost: d.updateProductCost,
          idempotencyKey: d.idempotencyKey,
          lines: stockLines,
        },
        { receiptId, receiptItemIds: stockItemIds, tx },
      );
      await tx
        .update(receipts)
        .set({
          status: "confirmed",
          supplierName: d.supplierName ?? r.supplierName,
          supplierId: purchase.supplierId,
          receiptNumber: d.receiptNumber ?? r.receiptNumber,
          purchaseDate: d.purchaseDate ?? r.purchaseDate,
          confirmedBy: ctx.userId,
          confirmedAt: new Date(),
        })
        .where(eq(receipts.id, receiptId));
      await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "receipt.confirm", entityType: "receipt", entityId: receiptId, after: { purchaseId: purchase.id, lines: d.lines }, ip: ctx.ip });
      return { purchaseId: purchase.id, replayed: false };
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") {
      const p = await replay();
      if (p) return p;
    }
    throw e;
  }
}

export async function rejectReceipt(ctx: StoreContext, receiptId: string, input: unknown) {
  const { reason } = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) }).parse(input);
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.storeId, ctx.storeId))).for("update");
    if (!r) throw notFound("Receipt");
    if (r.status === "confirmed") throw new AppError("CONFLICT", "A confirmed receipt cannot be rejected. Adjust stock instead.");
    await tx.update(receipts).set({ status: "rejected", rejectedReason: reason }).where(eq(receipts.id, receiptId));
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "receipt.reject", entityType: "receipt", entityId: receiptId, before: { status: r.status }, after: { status: "rejected", reason }, ip: ctx.ip });
  });
}
