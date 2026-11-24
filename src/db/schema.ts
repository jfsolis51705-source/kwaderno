/**
 * KWADERNO database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 * - All primary keys are UUIDs (gen_random_uuid()).
 * - Money is stored as integer centavos (bigint, `*_centavos`). 1 PHP = 100 centavos.
 * - Stock quantities are numeric(14,3) so loose goods (rice per kilo, tingi oil)
 *   can be recorded. Quantities are always in the product's own unit; packaging
 *   variants are separate products linked by `pack_parent_id` (see docs/DATABASE.md).
 * - Every store-owned row carries `store_id` and every query must filter by it.
 * - Inventory quantity is never edited directly: it changes only through
 *   `inventory_transactions`, with `inventory_balances` as a locked running total.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

// ---------------------------------------------------------------- enums
export const memberRole = pgEnum("member_role", ["owner", "manager", "staff"]);
export const memberStatus = pgEnum("member_status", ["active", "invited", "removed"]);
export const businessType = pgEnum("business_type", [
  "sari_sari",
  "grocery",
  "restaurant",
  "online_selling",
  "auto_moto",
  "other",
]);
export const inventoryTxnType = pgEnum("inventory_txn_type", [
  "opening",
  "stock_in",
  "sale",
  "adjustment",
  "damaged",
  "expired",
  "supplier_return",
  "customer_return",
  "count_correction",
  "repack_out",
  "repack_in",
  "sale_void",
]);
export const receiptStatus = pgEnum("receipt_status", [
  "uploaded",
  "queued",
  "processing",
  "pending_review",
  "confirmed",
  "failed",
  "rejected",
]);
export const receiptItemAction = pgEnum("receipt_item_action", ["match", "create", "skip"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "gcash", "credit"]);
export const saleStatus = pgEnum("sale_status", ["completed", "voided"]);
export const purchaseStatus = pgEnum("purchase_status", ["completed", "voided"]);
export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "credit_sale",
  "payment",
  "adjustment",
  "sale_void",
]);
export const syncStatus = pgEnum("sync_status", ["received", "applied", "conflict", "failed"]);

// ---------------------------------------------------------------- identity
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    /** KELSON system owner. Only these users may see platform-level data such as pilot merchants. */
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const stores = pgTable(
  "stores",
  {
  id: id(),
  name: text("name").notNull(),
  businessType: businessType("business_type").notNull().default("sari_sari"),
  ownerName: text("owner_name"),
  phone: text("phone"),
  addressLine: text("address_line"),
  barangay: text("barangay"),
  city: text("city"),
  province: text("province"),
  /** Store GPS position (WGS84), captured on the merchant's phone or entered manually. */
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  /** Set when this store is matched to a surveyed pilot merchant pin. */
  pilotMerchantId: uuid("pilot_merchant_id").references((): AnyPgColumn => pilotMerchants.id, { onDelete: "set null" }),
  currency: text("currency").notNull().default("PHP"),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  /** When false, sales that would drive stock below zero are rejected. */
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("stores_pilot_merchant_uq").on(t.pilotMerchantId).where(sql`${t.pilotMerchantId} is not null`),
    check("stores_lat_range", sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check("stores_lng_range", sql`${t.longitude} is null or ${t.longitude} between -180 and 180`),
    check("stores_latlng_pair", sql`(${t.latitude} is null) = (${t.longitude} is null)`),
  ],
);

/**
 * PLATFORM-LEVEL (not store-scoped) list of merchants surveyed in the field pilot.
 * Contains personal data (owner name, contact number). Visible only to platform admins.
 * Payment identifiers (GCash numbers, crypto wallets, payouts) are deliberately NOT stored.
 * Loaded by `npm run pilot:import` from git-ignored files in data/private/.
 */
export const pilotMerchants = pgTable(
  "pilot_merchants",
  {
    id: id(),
    /** Stable hash of layer + name + position; makes re-imports idempotent. */
    externalKey: text("external_key").notNull(),
    layer: text("layer").notNull(),
    surveyor: text("surveyor"),
    storeName: text("store_name").notNull(),
    businessType: text("business_type").notNull().default("sari_sari"),
    ownerName: text("owner_name"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    barangay: text("barangay"),
    city: text("city"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    signed: boolean("signed").notNull().default(false),
    registrationStatus: text("registration_status"),
    retentionStatus: text("retention_status"),
    surveyedOn: date("surveyed_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pilot_merchants_external_key_uq").on(t.externalKey), index("pilot_merchants_latlng_idx").on(t.latitude, t.longitude)],
);

export const storeMembers = pgTable(
  "store_members",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("staff"),
    status: memberStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("store_members_store_user_uq").on(t.storeId, t.userId),
    index("store_members_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------- catalog
export const categories = pgTable(
  "categories",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("categories_store_name_uq").on(t.storeId, sql`lower(${t.name})`)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    sku: text("sku"),
    name: text("name").notNull(),
    brand: text("brand"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** Unit the stock is counted in, e.g. "pc", "sachet", "box", "kg", "bottle". */
    unit: text("unit").notNull().default("pc"),
    packagingDescription: text("packaging_description"),
    purchaseCostCentavos: money("purchase_cost_centavos").notNull().default(0),
    sellingPriceCentavos: money("selling_price_centavos").notNull().default(0),
    reorderThreshold: qty("reorder_threshold").notNull().default("0"),
    /**
     * Packaging variant link. A "box of 12 sachets" product has
     * packChildId = the sachet product and packQuantity = 12. Each variant keeps
     * its own stock; converting a box into sachets is an explicit repack movement.
     */
    packChildId: uuid("pack_child_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
    packQuantity: qty("pack_quantity"),
    imagePath: text("image_path"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("products_store_idx").on(t.storeId),
    index("products_store_category_idx").on(t.storeId, t.categoryId),
    uniqueIndex("products_store_sku_uq")
      .on(t.storeId, sql`lower(${t.sku})`)
      .where(sql`${t.sku} is not null`),
    check("products_price_nonneg", sql`${t.sellingPriceCentavos} >= 0 and ${t.purchaseCostCentavos} >= 0`),
    check(
      "products_pack_pair",
      sql`(${t.packChildId} is null and ${t.packQuantity} is null) or (${t.packChildId} is not null and ${t.packQuantity} > 0)`,
    ),
  ],
);

export const productBarcodes = pgTable(
  "product_barcodes",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    barcode: text("barcode").notNull(),
    symbology: text("symbology"),
    createdAt: createdAt(),
  },
  (t) => [
    // A barcode identifies exactly one product within a store. Different stores may reuse it.
    uniqueIndex("product_barcodes_store_code_uq").on(t.storeId, t.barcode),
    index("product_barcodes_product_idx").on(t.productId),
  ],
);

// ---------------------------------------------------------------- inventory
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    quantity: qty("quantity").notNull().default("0"),
    /** Optimistic-concurrency counter, incremented on every movement. */
    version: integer("version").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [index("inventory_balances_store_idx").on(t.storeId)],
);

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: inventoryTxnType("type").notNull(),
    quantityDelta: qty("quantity_delta").notNull(),
    balanceAfter: qty("balance_after").notNull(),
    unitCostCentavos: money("unit_cost_centavos"),
    reason: text("reason"),
    /** e.g. "sale", "purchase", "receipt", "count" */
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_txn_store_created_idx").on(t.storeId, t.createdAt),
    index("inventory_txn_product_created_idx").on(t.productId, t.createdAt),
    uniqueIndex("inventory_txn_idem_uq")
      .on(t.storeId, t.idempotencyKey, t.productId)
      .where(sql`${t.idempotencyKey} is not null`),
    check("inventory_txn_nonzero", sql`${t.quantityDelta} <> 0`),
  ],
);

// ---------------------------------------------------------------- purchasing
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    address: text("address"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("suppliers_store_name_uq").on(t.storeId, sql`lower(${t.name})`)],
);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    filePath: text("file_path").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: text("sha256").notNull(),
    status: receiptStatus("status").notNull().default("uploaded"),
    provider: text("provider"),
    /** Raw, unmodified AI/OCR output. Never overwritten after extraction. */
    rawExtraction: jsonb("raw_extraction"),
    supplierName: text("supplier_name"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    receiptNumber: text("receipt_number"),
    purchaseDate: date("purchase_date"),
    discountCentavos: money("discount_centavos"),
    taxCentavos: money("tax_centavos"),
    grandTotalCentavos: money("grand_total_centavos"),
    overallConfidence: numeric("overall_confidence", { precision: 4, scale: 3 }),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("receipts_store_status_idx").on(t.storeId, t.status),
    index("receipts_store_sha_idx").on(t.storeId, t.sha256),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: id(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    rawDescription: text("raw_description").notNull(),
    extractedQuantity: qty("extracted_quantity"),
    extractedUnitPriceCentavos: money("extracted_unit_price_centavos"),
    extractedLineTotalCentavos: money("extracted_line_total_centavos"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    suggestedProductId: uuid("suggested_product_id").references(() => products.id),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    // Merchant-reviewed values (what is actually applied on confirmation)
    action: receiptItemAction("action"),
    productId: uuid("product_id").references(() => products.id),
    quantity: qty("quantity"),
    unitCostCentavos: money("unit_cost_centavos"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("receipt_items_receipt_line_uq").on(t.receiptId, t.lineNo)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    receiptId: uuid("receipt_id").references(() => receipts.id),
    referenceNo: text("reference_no"),
    purchaseDate: date("purchase_date").notNull(),
    subtotalCentavos: money("subtotal_centavos").notNull().default(0),
    discountCentavos: money("discount_centavos").notNull().default(0),
    taxCentavos: money("tax_centavos").notNull().default(0),
    totalCentavos: money("total_centavos").notNull().default(0),
    status: purchaseStatus("status").notNull().default("completed"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("purchases_store_date_idx").on(t.storeId, t.purchaseDate),
    uniqueIndex("purchases_idem_uq").on(t.storeId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    // A receipt can produce at most one purchase: hard guard against double confirmation.
    uniqueIndex("purchases_receipt_uq").on(t.receiptId).where(sql`${t.receiptId} is not null`),
  ],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: id(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: qty("quantity").notNull(),
    unitCostCentavos: money("unit_cost_centavos").notNull(),
    lineTotalCentavos: money("line_total_centavos").notNull(),
    receiptItemId: uuid("receipt_item_id").references(() => receiptItems.id),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId), check("purchase_items_qty_pos", sql`${t.quantity} > 0`)],
);

// ---------------------------------------------------------------- customers & sales
export const customers = pgTable(
  "customers",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
    creditLimitCentavos: money("credit_limit_centavos"),
    /** Running utang balance, kept in step with customer_ledger under a row lock. */
    balanceCentavos: money("balance_centavos").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("customers_store_name_idx").on(t.storeId, t.name)],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    saleNo: integer("sale_no").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    subtotalCentavos: money("subtotal_centavos").notNull(),
    discountCentavos: money("discount_centavos").notNull().default(0),
    totalCentavos: money("total_centavos").notNull(),
    paymentMethod: paymentMethod("payment_method").notNull(),
    amountTenderedCentavos: money("amount_tendered_centavos"),
    status: saleStatus("status").notNull().default("completed"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    /** When the sale actually happened on the device (may be earlier than createdAt for offline sync). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("sales_store_no_uq").on(t.storeId, t.saleNo),
    uniqueIndex("sales_idem_uq").on(t.storeId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("sales_store_occurred_idx").on(t.storeId, t.occurredAt),
    check("sales_totals", sql`${t.totalCentavos} = ${t.subtotalCentavos} - ${t.discountCentavos} and ${t.totalCentavos} >= 0`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    productName: text("product_name").notNull(),
    quantity: qty("quantity").notNull(),
    unitPriceCentavos: money("unit_price_centavos").notNull(),
    unitCostCentavos: money("unit_cost_centavos").notNull().default(0),
    discountCentavos: money("discount_centavos").notNull().default(0),
    lineTotalCentavos: money("line_total_centavos").notNull(),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId), index("sale_items_product_idx").on(t.productId), check("sale_items_qty_pos", sql`${t.quantity} > 0`)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").references(() => sales.id),
    customerId: uuid("customer_id").references(() => customers.id),
    method: paymentMethod("method").notNull(),
    amountCentavos: money("amount_centavos").notNull(),
    /** Merchant-entered reference (e.g. GCash ref no.). Recorded only, not verified. */
    referenceNo: text("reference_no"),
    idempotencyKey: text("idempotency_key"),
    receivedBy: uuid("received_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_store_created_idx").on(t.storeId, t.createdAt),
    uniqueIndex("payments_idem_uq").on(t.storeId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("payments_amount_pos", sql`${t.amountCentavos} > 0`),
  ],
);

export const customerLedger = pgTable(
  "customer_ledger",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    entryType: ledgerEntryType("entry_type").notNull(),
    /** Positive increases what the customer owes; negative reduces it. */
    amountCentavos: money("amount_centavos").notNull(),
    balanceAfterCentavos: money("balance_after_centavos").notNull(),
    saleId: uuid("sale_id").references(() => sales.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("customer_ledger_customer_idx").on(t.customerId, t.createdAt)],
);

// ---------------------------------------------------------------- audit & sync
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_store_created_idx").on(t.storeId, t.createdAt), index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Random ID generated and persisted by the client. */
    clientDeviceId: text("client_device_id").notNull(),
    label: text("label"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("devices_store_client_uq").on(t.storeId, t.clientDeviceId)],
);

export const syncOperations = pgTable(
  "sync_operations",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id),
    userId: uuid("user_id").references(() => users.id),
    /** Client-generated UUID for the queued operation; doubles as idempotency key. */
    operationId: text("operation_id").notNull(),
    opType: text("op_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: syncStatus("status").notNull().default("received"),
    result: jsonb("result"),
    errorMessage: text("error_message"),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    createdAt: createdAt(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sync_operations_store_op_uq").on(t.storeId, t.operationId), index("sync_operations_store_status_idx").on(t.storeId, t.status)],
);

/** Per-store sale number counter (avoids MAX()+1 races). */
export const storeCounters = pgTable(
  "store_counters",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [uniqueIndex("store_counters_pk").on(t.storeId, t.name)],
);

// ---------------------------------------------------------------- expiry tracking
export const expiryStatus = pgEnum("expiry_status", ["active", "cleared"]);
export const expiryClearReason = pgEnum("expiry_clear_reason", ["sold_out", "disposed", "returned"]);

/**
 * A tracked batch of a product with an expiry date. Captured as a strict two-photo
 * sequence: (1) the physical product, then (2) its expiry label, so every date is
 * backed by visual evidence. Disposing records an `expired` inventory movement.
 */
export const productExpiries = pgTable(
  "product_expiries",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    expiryDate: date("expiry_date").notNull(),
    /** Units with this date, if counted (optional). */
    quantity: qty("quantity"),
    productPhotoPath: text("product_photo_path").notNull(),
    labelPhotoPath: text("label_photo_path").notNull(),
    note: text("note"),
    status: expiryStatus("status").notNull().default("active"),
    clearReason: expiryClearReason("clear_reason"),
    clearedBy: uuid("cleared_by").references(() => users.id),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    inventoryTransactionId: uuid("inventory_transaction_id").references(() => inventoryTransactions.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_expiries_store_status_date_idx").on(t.storeId, t.status, t.expiryDate),
    index("product_expiries_product_idx").on(t.productId),
    check("product_expiries_qty_pos", sql`${t.quantity} is null or ${t.quantity} > 0`),
  ],
);
