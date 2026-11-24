import { notFound } from "@/server/errors";
import { storeRoute } from "@/server/http";
import { expiryPhoto } from "@/server/services/expiry";

export const GET = storeRoute<{ storeId: string; expiryId: string; kind: string }>(async (_req, { store, params }) => {
  if (params.kind !== "product" && params.kind !== "label") throw notFound("Photo");
  const f = await expiryPhoto(store, params.expiryId, params.kind);
  return new Response(new Uint8Array(f.buffer), {
    headers: { "content-type": f.mimeType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
});
