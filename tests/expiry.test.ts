import { describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as list, POST as track } from "@/app/api/v1/stores/[storeId]/expiries/route";
import { POST as clear } from "@/app/api/v1/stores/[storeId]/expiries/[expiryId]/clear/route";
import { GET as photo } from "@/app/api/v1/stores/[storeId]/expiries/[expiryId]/photo/[kind]/route";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

type M = Awaited<ReturnType<typeof newMerchant>>;
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8), randomBytes(24)]);
const day = (offset: number) => new Date(Date.now() + offset * 864e5 + 8 * 3600e3).toISOString().slice(0, 10);

async function post(m: M, fields: Record<string, string>, files: { productPhoto?: Buffer; labelPhoto?: Buffer }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, v] of Object.entries(files)) if (v) form.append(k, new Blob([new Uint8Array(v)], { type: "image/png" }), `${k}.png`);
  const req = new NextRequest("http://localhost:3000/x", { method: "POST", headers: { cookie: m.cookie, "x-forwarded-for": "127.0.0.1" }, body: form });
  const res = await track(req, { params: Promise.resolve({ storeId: m.storeId }) });
  return { status: res.status, json: await res.json() };
}
async function product(m: M) {
  return (await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { name: "Bear Brand 33g", sellingPriceCentavos: 1200, openingQuantity: 20 } })).json.data.id as string;
}

describe("expiry tracking", () => {
  it("requires the product photo first and the label photo second", async () => {
    const m = await newMerchant();
    const p = await product(m);
    const noPhotos = await post(m, { productId: p, expiryDate: day(5) }, {});
    expect(noPhotos.status).toBe(422);
    expect(noPhotos.json.error.message).toMatch(/Step 1/);
    const noLabel = await post(m, { productId: p, expiryDate: day(5) }, { productPhoto: png() });
    expect(noLabel.json.error.message).toMatch(/Step 2/);
    const ok = await post(m, { productId: p, expiryDate: day(5), quantity: "6" }, { productPhoto: png(), labelPhoto: png() });
    expect(ok.status).toBe(201);
    const ph = await photo(new NextRequest("http://localhost/x", { headers: { cookie: m.cookie } }), { params: Promise.resolve({ storeId: m.storeId, expiryId: ok.json.data.id, kind: "label" }) });
    expect(ph.status).toBe(200);
    expect(ph.headers.get("content-type")).toBe("image/png");
  });

  it("groups into expired / this week / this month and lists soonest first", async () => {
    const m = await newMerchant();
    const p = await product(m);
    for (const off of [20, -2, 3]) await post(m, { productId: p, expiryDate: day(off) }, { productPhoto: png(), labelPhoto: png() });
    const r = await call(list, { cookie: m.cookie, params: { storeId: m.storeId } });
    expect(r.json.data.summary).toEqual({ expired: 1, soon: 1, month: 1 });
    expect(r.json.data.items.map((i: { days_left: number }) => i.days_left)).toEqual([-2, 3, 20]);
  });

  it("disposing records an expired stock movement once; sold out just closes the batch", async () => {
    const m = await newMerchant();
    const p = await product(m);
    const a = (await post(m, { productId: p, expiryDate: day(-1), quantity: "4" }, { productPhoto: png(), labelPhoto: png() })).json.data.id;
    const b = (await post(m, { productId: p, expiryDate: day(10) }, { productPhoto: png(), labelPhoto: png() })).json.data.id;
    const body = { reason: "disposed", idempotencyKey: randomUUID() };
    expect((await call(clear, { cookie: m.cookie, params: { storeId: m.storeId, expiryId: a }, body })).status).toBe(201);
    expect((await call(clear, { cookie: m.cookie, params: { storeId: m.storeId, expiryId: a }, body })).json.data.replayed).toBe(true);
    const noQty = await call(clear, { cookie: m.cookie, params: { storeId: m.storeId, expiryId: b }, body: { reason: "disposed", idempotencyKey: randomUUID() } });
    expect(noQty.status).toBe(422);
    expect((await call(clear, { cookie: m.cookie, params: { storeId: m.storeId, expiryId: b }, body: { reason: "sold_out", idempotencyKey: randomUUID() } })).status).toBe(201);
    const stock = (await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: p } })).json.data.quantity;
    expect(Number(stock)).toBe(16);
    expect((await call(list, { cookie: m.cookie, params: { storeId: m.storeId } })).json.data.items).toHaveLength(0);
  });

  it("is store-isolated", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const p = await product(a);
    expect((await post(b, { productId: p, expiryDate: day(5) }, { productPhoto: png(), labelPhoto: png() })).status).toBe(404);
    const e = (await post(a, { productId: p, expiryDate: day(5) }, { productPhoto: png(), labelPhoto: png() })).json.data.id;
    expect((await call(clear, { cookie: b.cookie, params: { storeId: b.storeId, expiryId: e }, body: { reason: "sold_out", idempotencyKey: randomUUID() } })).status).toBe(404);
  });
});
