import { z } from "zod";
import { centavos, idempotencyKey, quantity } from "./validation-catalog";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const paymentMethods = ["cash", "gcash", "credit"] as const;

export const saleSchema = z
  .object({
    idempotencyKey,
    lines: z
      .array(z.object({ productId: z.uuid(), quantity }))
      .min(1, "The cart is empty")
      .max(200),
    /** Whole-sale discount in centavos. Needs manager or owner. */
    discountCentavos: centavos.default(0),
    paymentMethod: z.enum(paymentMethods),
    /** Cash only: how much the customer handed over. */
    amountTenderedCentavos: centavos.optional().nullable(),
    /** GCash only: reference number the merchant typed from the customer's screen. Recorded, NOT verified. */
    referenceNo: optText(60),
    customerId: z.uuid().optional().nullable(),
    notes: optText(300),
    /** When the sale happened on the device (offline sync). Defaults to now. */
    occurredAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.paymentMethod !== "credit" || v.customerId, { message: "Choose the customer for utang", path: ["customerId"] });
export type SaleInput = z.input<typeof saleSchema>;

export const voidSaleSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?63|0)9\d{9}$/, "Use a PH mobile number like 09171234567")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  address: optText(200),
  notes: optText(300),
  creditLimitCentavos: centavos.optional().nullable(),
});
export const customerUpdateSchema = customerSchema.partial();

export const customerPaymentSchema = z.object({
  amountCentavos: centavos.refine((n) => n > 0, "Enter an amount"),
  method: z.enum(["cash", "gcash"]),
  referenceNo: optText(60),
  note: optText(300),
  idempotencyKey,
});

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  filter: z.enum(["all", "owing"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
