import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { GET as listSales, POST as sell } from "@/app/api/v1/stores/[storeId]/sales/route";
import { POST as voidSale } from "@/app/api/v1/stores/[storeId]/sales/[saleId]/void/route";
import { GET as listCustomers, POST as createCustomer } from "@/app/api/v1/stores/[storeId]/customers/route";
import { GET as getCustomer, PATCH as patchCustomer } from "@/app/api/v1/stores/[storeId]/customers/[customerId]/route";
import { POST as pay } from "@/app/api/v1/stores/[storeId]/customers/[customerId]/payments/route";
import { POST as addMember } from "@/app/api/v1/stores/[storeId]/members/route";
import { GET as dashboard } from "@/app/api/v1/stores/[storeId]/dashboard/route";
import { getPool } from "@/db";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

type M = Awaited<ReturnType<typeof newMerchant>>;
const key = () => randomUUID();
const P = (m: M) => ({ cookie: m.cookie, params: { storeId: m.storeId } });
async function product(m: M, name: string, priceCentavos: number, stock: number, cost = 0) {
  const r = await call(createProduct, { ...P(m), body: { name, sellingPriceCentavos: priceCentavos, purchaseCostCentavos: cost, openingQuantity: stock } });
  return r.json.data.id as string;
}
const stock = async (m: M, id: string) => Number((await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: id } })).json.data.quantity);
async function customer(m: M, body: object = { name: "Aling Rosa" }) {
  return (await call(createCustomer, { ...P(m), body })).json.data.id as string;
}

describe("sales and checkout", () => {
  it("cash sale: server-side prices, stock deducted, payment recorded, change computed", async () => {
    const m = await newMerchant();
    const canton = await product(m, "Pancit Canton", 1600, 20, 1350);
    const coke = await product(m, "Coke Mismo", 2000, 10, 1700);
    const r = await call(sell, {
      ...P(m),
      body: { idempotencyKey: key(), paymentMethod: "cash", amountTenderedCentavos: 10000, lines: [{ productId: canton, quantity: 2 }, { productId: coke, quantity: 1 }, { productId: canton, quantity: 1 }] },
    });
    expect(r.status).toBe(201);
    const s = r.json.data;
    expect(s).toMatchObject({ saleNo: 1, totalCentavos: 3 * 1600 + 2000, changeCentavos: 10000 - 6800, status: "completed" });
    expect(s.items).toHaveLength(2); // duplicate lines merged
    expect(s.payments).toEqual([{ method: "cash", amountCentavos: 6800, referenceNo: null }]);
    expect(await stock(m, canton)).toBe(17);
    expect(await stock(m, coke)).toBe(9);
    const second = await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "gcash", referenceNo: "1234567890123", lines: [{ productId: coke, quantity: 1 }] } });
    expect(second.json.data.saleNo).toBe(2);
    expect(second.json.data.payments[0]).toMatchObject({ method: "gcash", referenceNo: "1234567890123" });
    const d = await call(dashboard, P(m));
    expect(d.json.data.sales).toMatchObject({ count: 2, totalCentavos: 8800, byMethod: { cash: 6800, gcash: 2000, credit: 0 } });
  });

  it("is atomic: if one line lacks stock nothing is saved", async () => {
    const m = await newMerchant();
    const a = await product(m, "A", 100, 5);
    const b = await product(m, "B", 100, 1);
    const r = await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "cash", lines: [{ productId: a, quantity: 2 }, { productId: b, quantity: 3 }] } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await stock(m, a)).toBe(5);
    const { rows } = await getPool().query("select (select count(*) from sales)::int s, (select count(*) from payments)::int p, (select count(*) from store_counters)::int c");
    expect(rows[0]).toEqual({ s: 0, p: 0, c: 0 });
  });

  it("retrying with the same idempotency key does not double-sell", async () => {
    const m = await newMerchant();
    const a = await product(m, "A", 100, 10);
    const body = { idempotencyKey: key(), paymentMethod: "cash", lines: [{ productId: a, quantity: 3 }] };
    const rs = await Promise.all([1, 2, 3].map(() => call(sell, { ...P(m), body })));
    expect(new Set(rs.map((r) => r.json.data.id)).size).toBe(1);
    expect(await stock(m, a)).toBe(7);
  });

  it("rejects too little cash, foreign products, and discounts by staff", async () => {
    const owner = await newMerchant();
    const other = await newMerchant();
    const a = await product(owner, "A", 1000, 10);
    const foreign = await product(other, "X", 1000, 10);
    expect((await call(sell, { ...P(owner), body: { idempotencyKey: key(), paymentMethod: "cash", amountTenderedCentavos: 500, lines: [{ productId: a, quantity: 1 }] } })).status).toBe(422);
    expect((await call(sell, { ...P(owner), body: { idempotencyKey: key(), paymentMethod: "cash", lines: [{ productId: foreign, quantity: 1 }] } })).status).toBe(404);
    expect(await stock(other, foreign)).toBe(10);
    const staff = await newMerchant();
    await call(addMember, { ...P(owner), body: { email: staff.email, role: "staff" } });
    const asStaff = { cookie: staff.cookie, params: { storeId: owner.storeId } };
    expect((await call(sell, { ...asStaff, body: { idempotencyKey: key(), paymentMethod: "cash", discountCentavos: 100, lines: [{ productId: a, quantity: 1 }] } })).status).toBe(403);
    const disc = await call(sell, { ...P(owner), body: { idempotencyKey: key(), paymentMethod: "cash", discountCentavos: 100, lines: [{ productId: a, quantity: 1 }] } });
    expect(disc.json.data).toMatchObject({ subtotalCentavos: 1000, discountCentavos: 100, totalCentavos: 900 });
  });

  it("void returns stock and reverses utang; only managers can void", async () => {
    const m = await newMerchant();
    const a = await product(m, "A", 500, 10);
    const c = await customer(m);
    const s = await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 4 }] } });
    const v = await call(voidSale, { cookie: m.cookie, params: { storeId: m.storeId, saleId: s.json.data.id }, body: { reason: "Wrong item rung up" } });
    expect(v.json.data.status).toBe("voided");
    expect(await stock(m, a)).toBe(10);
    const cust = await call(getCustomer, { cookie: m.cookie, params: { storeId: m.storeId, customerId: c } });
    expect(cust.json.data.balanceCentavos).toBe(0);
    expect(cust.json.data.ledger.map((l: { entry_type: string }) => l.entry_type)).toEqual(["sale_void", "credit_sale"]);
    const again = await call(voidSale, { cookie: m.cookie, params: { storeId: m.storeId, saleId: s.json.data.id }, body: { reason: "Twice" } });
    expect(again.status).toBe(409);
    const list = await call(listSales, P(m));
    expect(list.json.data.completedTotalCentavos).toBe(0);
  });
});

describe("customers and utang", () => {
  it("credit sale increases balance; partial then full payment; history is never erased", async () => {
    const m = await newMerchant();
    const a = await product(m, "Rice 1kg", 5500, 50);
    const c = await customer(m, { name: "Mang Tomas", phone: "09171234567" });
    await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 2 }] } });
    await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 1 }] } });
    const cp = { cookie: m.cookie, params: { storeId: m.storeId, customerId: c } };
    expect((await call(getCustomer, cp)).json.data.balanceCentavos).toBe(16500);
    const p1 = await call(pay, { ...cp, body: { amountCentavos: 10000, method: "cash", idempotencyKey: key() } });
    expect(p1.status).toBe(201);
    expect(p1.json.data.balanceCentavos).toBe(6500);
    const over = await call(pay, { ...cp, body: { amountCentavos: 7000, method: "cash", idempotencyKey: key() } });
    expect(over.status).toBe(422);
    const p2 = await call(pay, { ...cp, body: { amountCentavos: 6500, method: "gcash", referenceNo: "9988", idempotencyKey: key() } });
    expect(p2.json.data.balanceCentavos).toBe(0);
    const none = await call(pay, { ...cp, body: { amountCentavos: 100, method: "cash", idempotencyKey: key() } });
    expect(none.status).toBe(409);
    const g = await call(getCustomer, cp);
    expect(g.json.data.ledger.map((l: { entry_type: string; balance_after_centavos: number }) => [l.entry_type, l.balance_after_centavos])).toEqual([
      ["payment", 0], ["payment", 6500], ["credit_sale", 16500], ["credit_sale", 11000],
    ]);
    const { rows } = await getPool().query("select sum(amount_centavos)::int s from customer_ledger where customer_id=$1", [c]);
    expect(rows[0].s).toBe(0); // ledger sums to balance
  });

  it("credit sale needs a customer and respects the credit limit", async () => {
    const m = await newMerchant();
    const a = await product(m, "A", 1000, 50);
    expect((await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", lines: [{ productId: a, quantity: 1 }] } })).status).toBe(422);
    const c = await customer(m, { name: "Limited", creditLimitCentavos: 2500 });
    expect((await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 2 }] } })).status).toBe(201);
    const over = await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 1 }] } });
    expect(over.status).toBe(409);
    expect(over.json.error.message).toMatch(/limit/);
    expect(await stock(m, a)).toBe(48); // the refused sale did not touch stock
  });

  it("concurrent payments never take the balance below zero", async () => {
    const m = await newMerchant();
    const a = await product(m, "A", 1000, 50);
    const c = await customer(m);
    await call(sell, { ...P(m), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 1 }] } });
    const cp = { cookie: m.cookie, params: { storeId: m.storeId, customerId: c } };
    const rs = await Promise.all(Array.from({ length: 5 }, () => call(pay, { ...cp, body: { amountCentavos: 600, method: "cash", idempotencyKey: key() } })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await call(getCustomer, cp)).json.data.balanceCentavos).toBe(400);
  });

  it("search, owing filter, isolation, and balance is not directly editable", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const p = await product(a, "A", 1000, 50);
    const rosa = await customer(a, { name: "Aling Rosa", phone: "09170000000" });
    await customer(a, { name: "Kuya Ben" });
    await call(sell, { ...P(a), body: { idempotencyKey: key(), paymentMethod: "credit", customerId: rosa, lines: [{ productId: p, quantity: 1 }] } });
    const owing = await call(listCustomers, { ...P(a), path: "/x?filter=owing" });
    expect(owing.json.data).toMatchObject({ total: 1, totalOwedCentavos: 1000 });
    expect((await call(listCustomers, { ...P(a), path: "/x?q=ben" })).json.data.items[0].name).toBe("Kuya Ben");
    expect((await call(getCustomer, { cookie: b.cookie, params: { storeId: b.storeId, customerId: rosa } })).status).toBe(404);
    expect((await call(pay, { cookie: b.cookie, params: { storeId: b.storeId, customerId: rosa }, body: { amountCentavos: 1000, method: "cash", idempotencyKey: key() } })).status).toBe(404);
    await call(patchCustomer, { method: "PATCH", cookie: a.cookie, params: { storeId: a.storeId, customerId: rosa }, body: { name: "Rosa D.", balanceCentavos: 0 } });
    const g = await call(getCustomer, { cookie: a.cookie, params: { storeId: a.storeId, customerId: rosa } });
    expect(g.json.data).toMatchObject({ name: "Rosa D.", balanceCentavos: 1000 });
  });
});
