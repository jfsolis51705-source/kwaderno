import { storeRoute } from "@/server/http";
import { receiptFile } from "@/server/services/receipts";

/** Streams the original upload to authorised store members only. */
export const GET = storeRoute<{ storeId: string; receiptId: string }>(async (_req, { store, params }) => {
  const f = await receiptFile(store, params.receiptId);
  return new Response(new Uint8Array(f.buffer), {
    headers: {
      "content-type": f.mimeType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
