import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { POST as sell } from "@/app/api/v1/stores/[storeId]/sales/route";
import { POST as createCustomer } from "@/app/api/v1/stores/[storeId]/customers/route";
import { GET as report } from "@/app/api/v1/stores/[storeId]/reports/[type]/route";
import { GET as syncLog, POST as sync } from "@/app/api/v1/stores/[storeId]/sync/route";
import { GET as audit } from "@/app/api/v1/stores/[storeId]/audit/route";
import { POST as addMember } from "@/app/api/v1/stores/[storeId]/members/route";
import { getPool } from "@/db";
import { toCsv } from "@/server/services/reports";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

type M = Awaited<ReturnType<typeof newMerchant>>;
const P = (m: M) => ({ cookie: m.cookie, params: { storeId: m.storeId } });
async function product(m: M, name: string, price: number, stock: number, cost = 0) {
  return (await call(createProduct, { ...P(m), body: { name, sellingPriceCentavos: price, purchaseCostCentavos: cost, openingQuantity: stock, reorderThreshold: 5 } })).json.data.id as string;
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

describe("reports", () => {
  it("daily sales, by product and by payment come from the ledgers", async () => {
    const m = await newMerchant();
    const a = await product(m, "Sardines", 2400, 50, 2000);
    const b = await product(m, "Coffee", 300, 100, 250);
    const c = (await call(createCustomer, { ...P(m), body: { name: "Rosa" } })).json.data.id;
    await call(sell, { ...P(m), body: { idempotencyKey: randomUUID(), paymentMethod: "cash", lines: [{ productId: a, quantity: 2 }, { productId: b, quantity: 4 }] } });
    await call(sell, { ...P(m), body: { idempotencyKey: randomUUID(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 1 }] } });
    const r = (type: string) => call(report, { cookie: m.cookie, params: { storeId: m.storeId, type }, path: `/x?from=${today}&to=${today}` }).then((x) => x.json.data);
    const daily = await r("daily_sales");
    expect(daily.rows).toHaveLength(1);
    expect(daily.rows[0]).toMatchObject({ day: today, transactions: 2, cash: 6000, utang: 2400, total: 8400, gross_profit: 8400 - (3 * 2000 + 4 * 250) });
    const byProduct = await r("sales_by_product");
    expect(byProduct.rows[0]).toMatchObject({ product: "Sardines", quantity: 3, revenue: 7200, profit: 1200 });
    const byPay = await r("sales_by_payment");
    expect(byPay.rows.map((x: { method: string }) => x.method).sort()).toEqual(["Cash", "Utang"]);
    const utang = await r("utang");
    expect(utang.rows[0]).toMatchObject({ customer: "Rosa", balance: 2400 });
    const low = await r("low_stock");
    expect(low.rows).toHaveLength(0);
    const moves = await r("movements");
    expect(moves.rows.filter((x: { type: string }) => x.type === "sale")).toHaveLength(3);
    const bad = await call(report, { cookie: m.cookie, params: { storeId: m.storeId, type: "secret" } });
    expect(bad.status).toBe(404);
  });

  it("CSV export: UTF-8 BOM, quoting, pesos, and formula-injection protection", async () => {
    const m = await newMerchant();
    await product(m, '=HYPERLINK("http://evil","click"), "Ñ" brand', 1999, 3);
    const res = await report(new NextRequest(`http://localhost/x?format=csv`, { headers: { cookie: m.cookie } }), { params: Promise.resolve({ storeId: m.storeId, type: "inventory" }) });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="kwaderno-inventory-/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""click""), ""Ñ"" brand"`);
    expect(text).toContain(",19.99,");
    expect(toCsv({ type: "inventory", title: "", dated: false, columns: [{ key: "n", label: "N", type: "qty" }], rows: [{ n: -2 }] })).toContain("\r\n-2\r\n");
  });

  it("reports are store-isolated", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    await product(a, "Secret item", 100, 1);
    expect((await call(report, { cookie: b.cookie, params: { storeId: a.storeId, type: "inventory" } })).status).toBe(404);
    expect((await call(report, { cookie: b.cookie, params: { storeId: b.storeId, type: "inventory" } })).json.data.rows).toHaveLength(0);
  });
});

describe("offline sync", () => {
  it("applies queued sales once, even when the batch is resent", async () => {
    const m = await newMerchant();
    const a = await product(m, "Sardines", 2400, 10);
    const op = { operationId: randomUUID(), opType: "sale.create", clientCreatedAt: new Date(Date.now() - 3600_000).toISOString(), payload: { paymentMethod: "cash", lines: [{ productId: a, quantity: 2 }], occurredAt: new Date(Date.now() - 3600_000).toISOString() } };
    const body = { deviceId: "device-test-1", operations: [op] };
    const r1 = await call(sync, { ...P(m), body });
    expect(r1.json.data.results[0]).toMatchObject({ status: "applied", result: { saleNo: 1, totalCentavos: 4800 } });
    const r2 = await call(sync, { ...P(m), body });
    expect(r2.json.data.results[0].status).toBe("applied");
    const stock = (await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: a } })).json.data.quantity;
    expect(Number(stock)).toBe(8);
    const { rows } = await getPool().query("select count(*)::int n, min(occurred_at) t from sales where store_id=$1", [m.storeId]);
    expect(rows[0].n).toBe(1);
    expect(new Date(rows[0].t).getTime()).toBeLessThan(Date.now() - 3000_000); // keeps the offline time
  });

  it("reports conflicts (e.g. not enough stock) without applying or overwriting, then succeeds on retry", async () => {
    const m = await newMerchant();
    const a = await product(m, "Last one", 100, 1);
    const ok = { operationId: randomUUID(), opType: "sale.create", payload: { paymentMethod: "cash", lines: [{ productId: a, quantity: 1 }] } };
    const tooMany = { operationId: randomUUID(), opType: "sale.create", payload: { paymentMethod: "cash", lines: [{ productId: a, quantity: 1 }] } };
    const r = await call(sync, { ...P(m), body: { deviceId: "device-test-2", operations: [ok, tooMany] } });
    expect(r.json.data.results.map((x: { status: string }) => x.status)).toEqual(["applied", "conflict"]);
    expect(r.json.data.results[1].error.code).toBe("INSUFFICIENT_STOCK");
    const log = await call(syncLog, P(m));
    expect(log.json.data.map((x: { status: string }) => x.status).sort()).toEqual(["applied", "conflict"]);
    // Merchant receives stock, then retries the same operation.
    await getPool().query("update inventory_balances set quantity = 5 where product_id = $1", [a]);
    const retry = await call(sync, { ...P(m), body: { deviceId: "device-test-2", operations: [tooMany] } });
    expect(retry.json.data.results[0].status).toBe("applied");
  });

  it("applies queued stock adjustments and utang payments exactly once", async () => {
    const m = await newMerchant();
    const a = await product(m, "Eggs", 900, 30);
    const c = (await call(createCustomer, { ...P(m), body: { name: "Mang Tomas" } })).json.data.id;
    await call(sell, { ...P(m), body: { idempotencyKey: randomUUID(), paymentMethod: "credit", customerId: c, lines: [{ productId: a, quantity: 2 }] } });
    const ops = [
      { operationId: randomUUID(), opType: "inventory.adjust", payload: { productId: a, type: "damaged", quantity: 3, reason: "Cracked tray (offline)" } },
      { operationId: randomUUID(), opType: "customer.payment", payload: { customerId: c, amountCentavos: 1000, method: "cash" } },
    ];
    for (let i = 0; i < 2; i++) {
      const r = await call(sync, { ...P(m), body: { deviceId: "device-test-3", operations: ops } });
      expect(r.json.data.results.map((x: { status: string }) => x.status)).toEqual(["applied", "applied"]);
    }
    const stock = (await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: a } })).json.data.quantity;
    expect(Number(stock)).toBe(25);
    const { rows } = await getPool().query("select balance_centavos from customers where id=$1", [c]);
    expect(Number(rows[0].balance_centavos)).toBe(800);
  });

  it("rejects unknown operation types and cross-store products", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const foreign = await product(a, "A", 100, 5);
    const bad = await call(sync, { ...P(b), body: { deviceId: "device-x-123", operations: [{ operationId: randomUUID(), opType: "sale.delete", payload: {} }] } });
    expect(bad.status).toBe(422);
    const r = await call(sync, { ...P(b), body: { deviceId: "device-x-123", operations: [{ operationId: randomUUID(), opType: "sale.create", payload: { paymentMethod: "cash", lines: [{ productId: foreign, quantity: 1 }] } }] } });
    expect(r.json.data.results[0]).toMatchObject({ status: "conflict", error: { code: "NOT_FOUND" } });
  });
});

describe("audit log", () => {
  it("records changes and is visible to owners but not staff", async () => {
    const owner = await newMerchant();
    const staff = await newMerchant();
    await call(addMember, { ...P(owner), body: { email: staff.email, role: "staff" } });
    const a = await product(owner, "Audited", 100, 5);
    await call(sell, { ...P(owner), body: { idempotencyKey: randomUUID(), paymentMethod: "cash", lines: [{ productId: a, quantity: 1 }] } });
    const r = await call(audit, { ...P(owner), path: "/x?action=sale." });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0]).toMatchObject({ action: "sale.create", user_name: expect.any(String) });
    const all = await call(audit, P(owner));
    expect(all.json.data.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["store.create", "member.add", "product.create", "sale.create"]));
    expect((await call(audit, { cookie: staff.cookie, params: { storeId: owner.storeId } })).status).toBe(403);
  });
});
