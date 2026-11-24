import { AppError } from "@/server/errors";
import { ok, storeRoute } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { maxUploadBytes } from "@/server/storage";
import { expirySummary, listExpiries, trackExpiry } from "@/server/services/expiry";

export const GET = storeRoute(async (req, { store }) => {
  const status = req.nextUrl.searchParams.get("status") === "cleared" ? "cleared" : "active";
  const [items, summary] = await Promise.all([listExpiries(store, { status }), expirySummary(store)]);
  return ok({ items, summary });
});

/** multipart: productPhoto (step 1), labelPhoto (step 2), productId, expiryDate (YYYY-MM-DD), quantity?, note? */
export const POST = storeRoute(async (req, { store }) => {
  rateLimit(`expiry-upload:${store.userId}`, 120, 60 * 60 * 1000);
  if (Number(req.headers.get("content-length") ?? 0) > 2 * maxUploadBytes() + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "Photos are too large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Send the photos as multipart form data");
  }
  const file = async (k: string) => {
    const f = form.get(k);
    return f instanceof File && f.size ? Buffer.from(await f.arrayBuffer()) : null;
  };
  const str = (k: string) => (typeof form.get(k) === "string" && form.get(k) !== "" ? String(form.get(k)) : undefined);
  const row = await trackExpiry(store, { productId: str("productId"), expiryDate: str("expiryDate"), quantity: str("quantity"), note: str("note") }, { product: await file("productPhoto"), label: await file("labelPhoto") });
  return ok(row, 201);
});
