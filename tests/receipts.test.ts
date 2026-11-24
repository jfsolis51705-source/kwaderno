import { describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { GET as listReceipts, POST as uploadRoute } from "@/app/api/v1/stores/[storeId]/receipts/route";
import { GET as getReceipt } from "@/app/api/v1/stores/[storeId]/receipts/[receiptId]/route";
import { GET as getFile } from "@/app/api/v1/stores/[storeId]/receipts/[receiptId]/file/route";
import { POST as confirm } from "@/app/api/v1/stores/[storeId]/receipts/[receiptId]/confirm/route";
import { POST as reject } from "@/app/api/v1/stores/[storeId]/receipts/[receiptId]/reject/route";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { getPool } from "@/db";
import { processReceipt } from "@/server/services/receipts";
import { similarity } from "@/server/ai/match";
import type { Extractor } from "@/server/ai/extractor";
import { call, upload } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

type M = Awaited<ReturnType<typeof newMerchant>>;
// A unique valid-looking PNG each time (signature + random body) so duplicates are controlled.
const png = (seed = randomBytes(32)) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8), seed]);
const fakeAI: Extractor = async () => ({
  provider: "fake",
  supplierName: "Super8 Grocery Warehouse",
  receiptNumber: "S8-1001",
  purchaseDate: "2026-11-20",
  grandTotalCentavos: 72000,
  overallConfidence: 0.91,
  lines: [
    { description: "MEGA SARDINES TOMATO 155G", quantity: 24, unitPriceCentavos: 2000, lineTotalCentavos: 48000, confidence: 0.95 },
    { description: "UFC BANANA KETCHUP 320G", quantity: 12, unitPriceCentavos: 2000, lineTotalCentavos: 24000, confidence: 0.88 },
  ],
  raw: { text: "original OCR text" },
});

async function setup(m: M) {
  const r = await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { name: "Mega Sardines in Tomato Sauce 155g", brand: "Mega", sellingPriceCentavos: 2400, openingQuantity: 5 } });
  return r.json.data.id as string;
}
async function uploadAndProcess(m: M, file = png()) {
  const u = await upload(uploadRoute, { cookie: m.cookie, params: { storeId: m.storeId }, file });
  expect(u.status).toBe(202);
  const id = u.json.data.receipt.id as string;
  await processReceipt(m.storeId, id, fakeAI);
  return { id, upload: u.json.data };
}
const RP = (m: M, receiptId: string) => ({ cookie: m.cookie, params: { storeId: m.storeId, receiptId } });
const stock = async (m: M, id: string) => Number((await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: id } })).json.data.quantity);

describe("receipt upload and AI review", () => {
  it("validates file type by content and size; stores privately", async () => {
    const m = await newMerchant();
    const bad = await upload(uploadRoute, { cookie: m.cookie, params: { storeId: m.storeId }, file: Buffer.from("<html>not an image</html>"), filename: "x.png" });
    expect(bad.status).toBe(415);
    const { id } = await uploadAndProcess(m);
    const f = await getFile(new (await import("next/server")).NextRequest("http://localhost/x", { headers: { cookie: m.cookie } }), { params: Promise.resolve({ storeId: m.storeId, receiptId: id }) });
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("image/png");
    const other = await newMerchant();
    const f2 = await getFile(new (await import("next/server")).NextRequest("http://localhost/x", { headers: { cookie: other.cookie } }), { params: Promise.resolve({ storeId: m.storeId, receiptId: id }) });
    expect(f2.status).toBe(404);
  });

  it("processing extracts lines, matches known products, and never changes stock", async () => {
    const m = await newMerchant();
    const sardines = await setup(m);
    const { id } = await uploadAndProcess(m);
    const r = await call(getReceipt, RP(m, id));
    expect(r.json.data.status).toBe("pending_review");
    expect(r.json.data.rawExtraction.raw).toEqual({ text: "original OCR text" });
    const [l1, l2] = r.json.data.items;
    expect(l1).toMatchObject({ action: "match", productId: sardines, quantity: 24, unitCostCentavos: 2000 });
    expect(l1.matchConfidence).toBeGreaterThan(0.45);
    expect(l2).toMatchObject({ action: "create", productId: null });
    expect(await stock(m, sardines)).toBe(5); // not touched until confirmation
  });

  it("confirm applies reviewed values, creates new products, links purchase, and is idempotent", async () => {
    const m = await newMerchant();
    const sardines = await setup(m);
    const { id } = await uploadAndProcess(m);
    const items = (await call(getReceipt, RP(m, id))).json.data.items;
    const body = {
      idempotencyKey: randomUUID(),
      supplierName: "Super8 Grocery Warehouse",
      lines: [
        { id: items[0].id, rawDescription: items[0].rawDescription, action: "match", productId: sardines, quantity: 23, unitCostCentavos: 2000 }, // merchant corrected 24 → 23
        { id: items[1].id, rawDescription: items[1].rawDescription, action: "create", quantity: 12, unitCostCentavos: 2000, newProduct: { name: "UFC Banana Catsup 320g", unit: "bottle", sellingPriceCentavos: 2500 } },
        { rawDescription: "Free sachet (added by hand)", action: "skip" },
      ],
    };
    const c = await call(confirm, { ...RP(m, id), body });
    expect(c.status).toBe(201);
    expect(await stock(m, sardines)).toBe(28);
    const again = await call(confirm, { ...RP(m, id), body: { ...body, idempotencyKey: randomUUID() } });
    expect(again.status).toBe(200);
    expect(again.json.data.replayed).toBe(true);
    expect(await stock(m, sardines)).toBe(28);
    const r = await call(getReceipt, RP(m, id));
    expect(r.json.data.status).toBe("confirmed");
    expect(r.json.data.purchase.totalCentavos).toBe(23 * 2000 + 12 * 2000);
    expect(r.json.data.items[0].extracted.quantity).toBe(24); // original extraction preserved
    expect(r.json.data.items[0].quantity).toBe(23);
    const { rows } = await getPool().query("select count(*)::int n from purchases where receipt_id=$1", [id]);
    expect(rows[0].n).toBe(1);
    const ketchup = await getPool().query("select p.name, b.quantity from products p join inventory_balances b on b.product_id = p.id where p.store_id=$1 and p.name like 'UFC%'", [m.storeId]);
    expect(ketchup.rows[0]).toMatchObject({ name: "UFC Banana Catsup 320g", quantity: "12.000" });
  });

  it("parallel confirmations apply once", async () => {
    const m = await newMerchant();
    const sardines = await setup(m);
    const { id } = await uploadAndProcess(m);
    const items = (await call(getReceipt, RP(m, id))).json.data.items;
    const mk = () => ({ idempotencyKey: randomUUID(), lines: [{ id: items[0].id, rawDescription: "x", action: "match", productId: sardines, quantity: 10, unitCostCentavos: 2000 }] });
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(confirm, { ...RP(m, id), body: mk() })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await stock(m, sardines)).toBe(15);
  });

  it("validates review lines and blocks confirming the same photo twice", async () => {
    const m = await newMerchant();
    const sardines = await setup(m);
    const photo = png();
    const a = await uploadAndProcess(m, photo);
    const b = await uploadAndProcess(m, photo);
    expect(b.upload.duplicateOf.id).toBe(a.id);
    const invalid = await call(confirm, { ...RP(m, a.id), body: { idempotencyKey: randomUUID(), lines: [{ rawDescription: "x", action: "match" }] } });
    expect(invalid.status).toBe(422);
    const line = { rawDescription: "x", action: "match", productId: sardines, quantity: 1, unitCostCentavos: 100 };
    expect((await call(confirm, { ...RP(m, a.id), body: { idempotencyKey: randomUUID(), lines: [line] } })).status).toBe(201);
    const dup = await call(confirm, { ...RP(m, b.id), body: { idempotencyKey: randomUUID(), lines: [line] } });
    expect(dup.status).toBe(409);
    expect((await call(reject, { ...RP(m, b.id), body: { reason: "Duplicate photo" } })).status).toBe(200);
    expect((await call(reject, { ...RP(m, a.id), body: { reason: "Too late" } })).status).toBe(409);
  });

  it("works without AI: failure is recorded and items can be entered manually", async () => {
    const m = await newMerchant();
    const sardines = await setup(m);
    const u = await upload(uploadRoute, { cookie: m.cookie, params: { storeId: m.storeId }, file: png() });
    const id = u.json.data.receipt.id;
    delete process.env.AI_SERVICE_URL;
    const res = await processReceipt(m.storeId, id); // real HTTP extractor, not configured
    expect(res.processed).toBe(false);
    const r = await call(getReceipt, RP(m, id));
    expect(r.json.data).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/enter the items manually/) });
    const c = await call(confirm, { ...RP(m, id), body: { idempotencyKey: randomUUID(), lines: [{ rawDescription: "Mega sardines", action: "match", productId: sardines, quantity: 6, unitCostCentavos: 2000 }] } });
    expect(c.status).toBe(201);
    expect(await stock(m, sardines)).toBe(11);
  });

  it("isolates receipts between stores", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const { id } = await uploadAndProcess(a);
    expect((await call(getReceipt, { cookie: b.cookie, params: { storeId: b.storeId, receiptId: id } })).status).toBe(404);
    expect((await call(listReceipts, { cookie: b.cookie, params: { storeId: b.storeId } })).json.data).toHaveLength(0);
  });

  it("matcher scores receipt-style text against catalog names", () => {
    expect(similarity("MEGA SARDINES TOMATO 155G", "Mega Sardines in Tomato Sauce 155g")).toBeGreaterThan(0.6);
    expect(similarity("ALASKA EVAP 370ML", "Alaska Evaporada 370ml")).toBeGreaterThan(0.6);
    expect(similarity("SURF CHERRY 65G", "Datu Puti Soy Sauce 1L")).toBeLessThan(0.3);
  });
});
