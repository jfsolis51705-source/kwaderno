import { z } from "zod";

/** Shared client/server validation schemas. Server always re-validates. */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// Philippine mobile: 09XXXXXXXXX or +639XXXXXXXXX
export const phPhone = z
  .string()
  .trim()
  .regex(/^(\+?63|0)9\d{9}$/, "Use a PH mobile number like 09171234567")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

export const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Password is too long");

export const registerSchema = z.object({
  fullName: trimmed(120).min(2, "Enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: phPhone,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password").max(128),
});

export const businessTypes = ["sari_sari", "grocery", "restaurant", "online_selling", "auto_moto", "other"] as const;

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

const storeBase = z.object({
  name: trimmed(120).min(2, "Enter your store name"),
  businessType: z.enum(businessTypes).default("sari_sari"),
  ownerName: optionalText(120),
  phone: phPhone,
  addressLine: optionalText(200),
  barangay: optionalText(100),
  city: optionalText(100),
  province: optionalText(100),
  allowNegativeStock: z.boolean().optional(),
  /** GPS position of the store. Send both or neither; null clears it. */
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
});
const pairCheck = (v: { latitude?: number | null; longitude?: number | null }) => (v.latitude == null) === (v.longitude == null);
const pairMsg = { message: "Set both latitude and longitude, or neither", path: ["latitude"] };
export const storeSchema = storeBase.refine(pairCheck, pairMsg);
export type StoreInput = z.infer<typeof storeSchema>;
export const storeUpdateSchema = storeBase.partial().refine(pairCheck, pairMsg);

export const roles = ["owner", "manager", "staff"] as const;
export type Role = (typeof roles)[number];

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["manager", "staff"]),
});
export const updateMemberSchema = z.object({ role: z.enum(roles) });
