import { z } from "zod";
import { AppError } from "@/server/errors";

/**
 * Provider-independent receipt extraction contract. The Python AI service
 * (ai-service/) implements it over HTTP; tests inject a fake.
 * All money is integer centavos; dates are YYYY-MM-DD.
 */
export const extractionSchema = z.object({
  provider: z.string(),
  supplierName: z.string().nullish(),
  receiptNumber: z.string().nullish(),
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  discountCentavos: z.number().int().nonnegative().nullish(),
  taxCentavos: z.number().int().nonnegative().nullish(),
  grandTotalCentavos: z.number().int().nonnegative().nullish(),
  overallConfidence: z.number().min(0).max(1).nullish(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive().nullish(),
        unitPriceCentavos: z.number().int().nonnegative().nullish(),
        lineTotalCentavos: z.number().int().nonnegative().nullish(),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .max(300),
  raw: z.unknown().optional(),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type Extractor = (file: { buffer: Buffer; mimeType: string; filename: string }) => Promise<Extraction>;

/** Calls the AI service. Throws SERVICE_UNAVAILABLE when it is not configured or unreachable. */
export const httpExtractor: Extractor = async (file) => {
  const base = process.env.AI_SERVICE_URL;
  if (!base) throw new AppError("SERVICE_UNAVAILABLE", "Receipt AI is not set up. You can enter the items manually.");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);
  let res: Response;
  try {
    res = await fetch(new URL("/v1/extract", base), {
      method: "POST",
      body: form,
      headers: { authorization: `Bearer ${process.env.AI_SERVICE_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 120_000)),
    });
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", "Receipt AI is unreachable right now. Try again later or enter the items manually.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("SERVICE_UNAVAILABLE", `Receipt AI failed (${res.status}). ${body.slice(0, 200)}`.trim());
  }
  return extractionSchema.parse(await res.json());
};
