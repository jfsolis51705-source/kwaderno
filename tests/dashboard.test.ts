import { describe, expect, it } from "vitest";
import { GET as dashboard } from "@/app/api/v1/stores/[storeId]/dashboard/route";
import { getPool } from "@/db";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

/** Inserts rows directly (Stage 3/4 services don't exist yet) to prove the figures are DB-derived. */
async function seed(storeId: string, userId: string) {
  const q = (s: string, p: unknown[]) => getPool().query(s, p);
  const prod = async (name: string, cost: number, qty: number, reorder: number) => {
    const { rows } = await q(
      "insert into products (store_id, name, purchase_cost_centavos, selling_price_centavos, reorder_threshold) values ($1,$2,$3,$4,$5) returning id",
      [storeId, name, cost, Math.round(cost * 1.2), reorder],
    );
    await q("insert into inventory_balances (product_id, store_id, quantity) values ($1,$2,$3)", [rows[0].id, storeId, qty]);
    await q("insert into inventory_transactions (store_id, product_id, type, quantity_delta, balance_after, created_by) values ($1,$2,'opening',$3,$3,$4)", [storeId, rows[0].id, qty, userId]);
    return rows[0].id as string;
  };
  await prod("Lucky Me Pancit Canton", 1300, 40, 10);
  await prod("Kopiko Brown 3in1", 800, 5, 12); // low
  const sale = (no: number, total: number, method: string, at: string) =>
    q("insert into sales (store_id, sale_no, subtotal_centavos, total_centavos, payment_method, occurred_at, created_by) values ($1,$2,$3,$3,$4,$5,$6)", [storeId, no, total, method, at, userId]);
  // 2026-03-10 in Manila (UTC+8): 00:30 local = 2026-03-09T16:30Z
  await sale(1, 5000, "cash", "2026-03-09T16:30:00Z");
  await sale(2, 2500, "gcash", "2026-03-10T10:00:00Z");
  await sale(3, 1000, "credit", "2026-03-10T16:30:00Z"); // = Mar 11 00:30 Manila → excluded from Mar 10
  await q("insert into customers (store_id, name, balance_centavos) values ($1,'Mang Tomas',1000),($1,'Paid up',0)", [storeId]);
}

describe("dashboard", () => {
  it("computes figures from the database in the store's timezone", async () => {
    const m = await newMerchant();
    await seed(m.storeId, m.userId);
    const r = await call(dashboard, { cookie: m.cookie, params: { storeId: m.storeId }, path: `/api/v1/x?from=2026-03-10&to=2026-03-10` });
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d.sales.count).toBe(2);
    expect(d.sales.totalCentavos).toBe(7500);
    expect(d.sales.byMethod).toEqual({ cash: 5000, gcash: 2500, credit: 0 });
    expect(d.productCount).toBe(2);
    expect(d.inventoryValueCentavos).toBe(40 * 1300 + 5 * 800);
    expect(d.lowStock.count).toBe(1);
    expect(d.lowStock.items[0].name).toBe("Kopiko Brown 3in1");
    expect(d.utang).toEqual({ outstandingCentavos: 1000, customers: 1 });
    expect(d.recentMovements).toHaveLength(2);

    const range = await call(dashboard, { cookie: m.cookie, params: { storeId: m.storeId }, path: `/api/v1/x?from=2026-03-10&to=2026-03-11` });
    expect(range.json.data.sales.count).toBe(3);
  });

  it("never leaks another store's figures", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    await seed(a.storeId, a.userId);
    const r = await call(dashboard, { cookie: b.cookie, params: { storeId: b.storeId }, path: `/api/v1/x?from=2026-03-01&to=2026-03-31` });
    expect(r.json.data.sales.count).toBe(0);
    expect(r.json.data.productCount).toBe(0);
    expect(r.json.data.utang.outstandingCentavos).toBe(0);
    const cross = await call(dashboard, { cookie: b.cookie, params: { storeId: a.storeId } });
    expect(cross.status).toBe(404);
  });
});
