import { z } from "zod";

/** Quantity: positive, up to 3 decimals (e.g. 0.25 kg). Sent to SQL as a fixed string. */
export const quantity = z.coerce
  .number({ error: "Enter a quantity" })
  .positive("Must be more than 0")
  .max(1_000_000, "Too large")
  .refine((n) => Math.round(n * 1000) === n * 1000 || Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, "At most 3 decimal places");
export const nonNegQuantity = z.coerce.number().min(0, "Cannot be negative").max(1_000_000);
export const centavos = z.coerce.number().int("Invalid amount").min(0, "Cannot be negative").max(100_000_000_00);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const barcodeValue = z
  .string()
  .trim()
  .min(3, "Barcode is too short")
  .max(128, "Barcode is too long")
  .regex(/^[\x20-\x7E]+$/, "Barcode has unsupported characters");

export const productSchema = z.object({
  name: z.string().trim().min(1, "Enter the product name").max(160),
  sku: optText(64),
  brand: optText(80),
  categoryId: z.uuid().optional().nullable(),
  categoryName: optText(60), // creates the category if it doesn't exist
  unit: z.string().trim().min(1).max(20).default("pc"),
  packagingDescription: optText(120),
  purchaseCostCentavos: centavos.default(0),
  sellingPriceCentavos: centavos,
  reorderThreshold: nonNegQuantity.default(0),
  packChildId: z.uuid().optional().nullable(),
  packQuantity: quantity.optional().nullable(),
  isActive: z.boolean().optional(),
  barcodes: z.array(barcodeValue).max(10).optional(),
  openingQuantity: nonNegQuantity.optional(),
});
export type ProductInput = z.input<typeof productSchema>;
export const productUpdateSchema = productSchema.omit({ barcodes: true, openingQuantity: true }).partial();

export const productListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  filter: z.enum(["all", "low", "out", "archived"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idempotencyKey = z.string().trim().min(8).max(100);

/** Manual adjustment types merchants can record. Sales and repacks have their own flows. */
export const adjustmentTypes = ["opening", "stock_in", "adjustment", "damaged", "expired", "supplier_return", "customer_return"] as const;
export const INCREASE_TYPES = new Set(["opening", "stock_in", "customer_return"]);
export const DECREASE_TYPES = new Set(["damaged", "expired", "supplier_return"]);

export const adjustmentSchema = z
  .object({
    productId: z.uuid(),
    type: z.enum(adjustmentTypes),
    /** For "adjustment" the sign is given by `direction`; other types have a fixed direction. */
    quantity,
    direction: z.enum(["increase", "decrease"]).optional(),
    unitCostCentavos: centavos.optional().nullable(),
    reason: z.string().trim().min(3, "Give a short reason").max(300),
    idempotencyKey,
  })
  .refine((v) => v.type !== "adjustment" || v.direction, { message: "Choose increase or decrease", path: ["direction"] });

export const stockInSchema = z.object({
  supplierId: z.uuid().optional().nullable(),
  supplierName: optText(120),
  referenceNo: optText(60),
  purchaseDate: z.iso.date().optional(),
  notes: optText(300),
  updateProductCost: z.boolean().default(true),
  idempotencyKey,
  lines: z
    .array(z.object({ productId: z.uuid(), quantity, unitCostCentavos: centavos }))
    .min(1, "Add at least one item")
    .max(200),
});

export const countSchema = z.object({
  idempotencyKey,
  note: optText(300),
  lines: z.array(z.object({ productId: z.uuid(), countedQuantity: nonNegQuantity })).min(1).max(500),
});

export const repackSchema = z.object({
  packProductId: z.uuid(),
  packs: quantity,
  idempotencyKey,
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: optText(120),
  phone: optText(30),
  address: optText(200),
});
export const categorySchema = z.object({ name: z.string().trim().min(1).max(60) });
