import { describe, expect, it } from "vitest";
import { GET as listProducts, POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct, PATCH as patchProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { POST as archive, DELETE as restore } from "@/app/api/v1/stores/[storeId]/products/[productId]/archive/route";
import { POST as addBarcode } from "@/app/api/v1/stores/[storeId]/products/[productId]/barcodes/route";
import { DELETE as removeBarcode } from "@/app/api/v1/stores/[storeId]/products/[productId]/barcodes/[barcode]/route";
import { GET as lookup } from "@/app/api/v1/stores/[storeId]/barcodes/[code]/route";
import { POST as addMember } from "@/app/api/v1/stores/[storeId]/members/route";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

const canton = { name: "Lucky Me Pancit Canton Original", brand: "Lucky Me", categoryName: "Noodles", unit: "pack", sellingPriceCentavos: 1600, purchaseCostCentavos: 1350, reorderThreshold: 10, barcodes: ["4807770270017"] };

async function product(m: { cookie: string; storeId: string }, body: object = canton) {
  const r = await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body });
  if (r.status !== 201) throw new Error(JSON.stringify(r.json));
  return r.json.data;
}

describe("product catalog", () => {
  it("creates a product with category, barcode and opening stock recorded in the ledger", async () => {
    const m = await newMerchant();
    const p = await product(m, { ...canton, openingQuantity: 24 });
    const g = await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } });
    expect(g.json.data).toMatchObject({ name: canton.name, category: "Noodles", quantity: "24.000", barcodes: ["4807770270017"], selling_price_centavos: 1600 });
  });

  it("validates required fields and money as integer centavos", async () => {
    const m = await newMerchant();
    const r = await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { name: "", sellingPriceCentavos: 12.5 } });
    expect(r.status).toBe(422);
    const paths = r.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "sellingPriceCentavos"]));
  });

  it("searches by name, brand and exact barcode; filters by low stock and category", async () => {
    const m = await newMerchant();
    await product(m, { ...canton, openingQuantity: 50 });
    await product(m, { name: "Kopiko Brown", brand: "Kopiko", categoryName: "Coffee", sellingPriceCentavos: 1000, reorderThreshold: 12, openingQuantity: 3 });
    const q = (s: string) => call(listProducts, { cookie: m.cookie, params: { storeId: m.storeId }, path: `/x?${s}` }).then((r) => r.json.data);
    expect((await q("q=canton")).items.map((i: { name: string }) => i.name)).toEqual([canton.name]);
    expect((await q("q=kopiko")).total).toBe(1);
    expect((await q("q=4807770270017")).items[0].name).toBe(canton.name);
    expect((await q("q=%25")).total).toBe(0); // LIKE wildcards are escaped
    expect((await q("filter=low")).items.map((i: { name: string }) => i.name)).toEqual(["Kopiko Brown"]);
  });

  it("archives (hidden from list, history kept) and restores", async () => {
    const m = await newMerchant();
    const p = await product(m);
    expect((await call(archive, { method: "POST", cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } })).status).toBe(200);
    const list = await call(listProducts, { cookie: m.cookie, params: { storeId: m.storeId } });
    expect(list.json.data.total).toBe(0);
    const archived = await call(listProducts, { cookie: m.cookie, params: { storeId: m.storeId }, path: "/x?filter=archived" });
    expect(archived.json.data.total).toBe(1);
    await call(restore, { method: "DELETE", cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } });
    expect((await call(listProducts, { cookie: m.cookie, params: { storeId: m.storeId } })).json.data.total).toBe(1);
  });

  it("staff can add products but cannot edit prices or archive", async () => {
    const owner = await newMerchant();
    const staff = await newMerchant();
    await call(addMember, { cookie: owner.cookie, params: { storeId: owner.storeId }, body: { email: staff.email, role: "staff" } });
    const p = await product({ cookie: staff.cookie, storeId: owner.storeId });
    const edit = await call(patchProduct, { method: "PATCH", cookie: staff.cookie, params: { storeId: owner.storeId, productId: p.id }, body: { sellingPriceCentavos: 1 } });
    expect(edit.status).toBe(403);
    const ok = await call(patchProduct, { method: "PATCH", cookie: owner.cookie, params: { storeId: owner.storeId, productId: p.id }, body: { sellingPriceCentavos: 1700 } });
    expect(ok.json.data.sellingPriceCentavos).toBe(1700);
  });

  it("isolates products between stores", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const p = await product(a);
    expect((await call(getProduct, { cookie: b.cookie, params: { storeId: b.storeId, productId: p.id } })).status).toBe(404);
    expect((await call(getProduct, { cookie: b.cookie, params: { storeId: a.storeId, productId: p.id } })).status).toBe(404);
    expect((await call(listProducts, { cookie: b.cookie, params: { storeId: b.storeId } })).json.data.total).toBe(0);
    const look = await call(lookup, { cookie: b.cookie, params: { storeId: b.storeId, code: "4807770270017" } });
    expect(look.json.data.found).toBe(false);
  });
});

describe("barcodes", () => {
  it("looks up a known barcode and reports unknown ones without inventing data", async () => {
    const m = await newMerchant();
    const p = await product(m);
    const hit = await call(lookup, { cookie: m.cookie, params: { storeId: m.storeId, code: "4807770270017" } });
    expect(hit.json.data).toMatchObject({ found: true, product: { id: p.id } });
    const miss = await call(lookup, { cookie: m.cookie, params: { storeId: m.storeId, code: "0000000000000" } });
    expect(miss.status).toBe(200);
    expect(miss.json.data).toEqual({ found: false, product: null });
  });

  it("supports multiple barcodes per product and rejects duplicates within a store", async () => {
    const m = await newMerchant();
    const p = await product(m);
    const p2 = await product(m, { name: "Other", sellingPriceCentavos: 100 });
    const add = await call(addBarcode, { cookie: m.cookie, params: { storeId: m.storeId, productId: p.id }, body: { barcode: "4807770270024" } });
    expect(add.status).toBe(201);
    const dup = await call(addBarcode, { cookie: m.cookie, params: { storeId: m.storeId, productId: p2.id }, body: { barcode: "4807770270017" } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.message).toContain(canton.name);
    const dupCreate = await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { name: "X", sellingPriceCentavos: 1, barcodes: ["4807770270024"] } });
    expect(dupCreate.status).toBe(409);
    expect((await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } })).json.data.barcodes).toHaveLength(2);
    await call(removeBarcode, { method: "DELETE", cookie: m.cookie, params: { storeId: m.storeId, productId: p.id, barcode: "4807770270024" } });
    expect((await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } })).json.data.barcodes).toHaveLength(1);
  });

  it("allows the same barcode in different stores", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    await product(a);
    await product(b);
    const hit = await call(lookup, { cookie: b.cookie, params: { storeId: b.storeId, code: "4807770270017" } });
    expect(hit.json.data.found).toBe(true);
  });
});
