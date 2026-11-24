import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { GET as getProduct } from "@/app/api/v1/stores/[storeId]/products/[productId]/route";
import { GET as history } from "@/app/api/v1/stores/[storeId]/products/[productId]/history/route";
import { POST as adjust } from "@/app/api/v1/stores/[storeId]/inventory/adjustments/route";
import { POST as stockIn } from "@/app/api/v1/stores/[storeId]/inventory/stock-in/route";
import { POST as count } from "@/app/api/v1/stores/[storeId]/inventory/counts/route";
import { POST as repack } from "@/app/api/v1/stores/[storeId]/inventory/repack/route";
import { POST as addMember } from "@/app/api/v1/stores/[storeId]/members/route";
import { getDb, getPool } from "@/db";
import { applyMovement } from "@/server/services/inventory";
import { requireStoreAccess } from "@/server/services/stores";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

type M = Awaited<ReturnType<typeof newMerchant>>;
const key = () => randomUUID();
async function mk(m: M, body: object) {
  const r = await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { sellingPriceCentavos: 1000, ...body } });
  return r.json.data as { id: string };
}
const qty = async (m: M, id: string) => Number((await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: id } })).json.data.quantity);
const ledgerSum = async (id: string) => Number((await getPool().query("select coalesce(sum(quantity_delta),0) s from inventory_transactions where product_id=$1", [id])).rows[0].s);

describe("inventory ledger", () => {
  it("manual stock-in creates a purchase, ledger rows, updates cost, and is idempotent", async () => {
    const m = await newMerchant();
    const a = await mk(m, { name: "Coke 1L", purchaseCostCentavos: 4500 });
    const b = await mk(m, { name: "Rice", unit: "kg" });
    const body = { supplierName: "Super8 Grocery Warehouse", referenceNo: "INV-001", idempotencyKey: key(), lines: [{ productId: a.id, quantity: 12, unitCostCentavos: 4700 }, { productId: b.id, quantity: 25.5, unitCostCentavos: 4800 }] };
    const r = await call(stockIn, { cookie: m.cookie, params: { storeId: m.storeId }, body });
    expect(r.status).toBe(201);
    expect(r.json.data.purchase.totalCentavos).toBe(12 * 4700 + 25.5 * 4800);
    expect(await qty(m, a.id)).toBe(12);
    expect(await qty(m, b.id)).toBe(25.5);
    const replay = await call(stockIn, { cookie: m.cookie, params: { storeId: m.storeId }, body });
    expect(replay.status).toBe(200);
    expect(replay.json.data.replayed).toBe(true);
    expect(replay.json.data.purchase.id).toBe(r.json.data.purchase.id);
    expect(await qty(m, a.id)).toBe(12); // not doubled
    const p = await call(getProduct, { cookie: m.cookie, params: { storeId: m.storeId, productId: a.id } });
    expect(p.json.data.purchase_cost_centavos).toBe(4700);
    const s = await getPool().query("select count(*) n from suppliers where store_id=$1", [m.storeId]);
    expect(Number(s.rows[0].n)).toBe(1);
  });

  it("records damaged/expired/returns with reason and user, and keeps balance == sum of ledger", async () => {
    const m = await newMerchant();
    const p = await mk(m, { name: "Bear Brand 33g", openingQuantity: 20 });
    const post = (body: object) => call(adjust, { cookie: m.cookie, params: { storeId: m.storeId }, body: { productId: p.id, idempotencyKey: key(), ...body } });
    expect((await post({ type: "damaged", quantity: 2, reason: "Punit ang sachet" })).status).toBe(201);
    expect((await post({ type: "expired", quantity: 3, reason: "Expired 2026-11" })).status).toBe(201);
    expect((await post({ type: "customer_return", quantity: 1, reason: "Returned unopened" })).status).toBe(201);
    expect((await post({ type: "supplier_return", quantity: 4, reason: "Wrong item delivered" })).status).toBe(201);
    expect((await post({ type: "adjustment", direction: "increase", quantity: 0.5, reason: "Found half pack" })).status).toBe(201);
    expect(await qty(m, p.id)).toBe(12.5);
    expect(await ledgerSum(p.id)).toBe(12.5);
    const h = await call(history, { cookie: m.cookie, params: { storeId: m.storeId, productId: p.id } });
    expect(h.json.data.map((x: { type: string }) => x.type)).toEqual(["adjustment", "supplier_return", "customer_return", "expired", "damaged", "opening"]);
    expect(h.json.data[3]).toMatchObject({ reason: "Expired 2026-11", quantity_delta: "-3.000", balance_after: "15.000", by: expect.any(String) });
  });

  it("requires a reason and rejects stock going below zero", async () => {
    const m = await newMerchant();
    const p = await mk(m, { name: "Eggs", openingQuantity: 2 });
    const noReason = await call(adjust, { cookie: m.cookie, params: { storeId: m.storeId }, body: { productId: p.id, type: "damaged", quantity: 1, reason: "", idempotencyKey: key() } });
    expect(noReason.status).toBe(422);
    const tooMany = await call(adjust, { cookie: m.cookie, params: { storeId: m.storeId }, body: { productId: p.id, type: "damaged", quantity: 3, reason: "Dropped tray", idempotencyKey: key() } });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await qty(m, p.id)).toBe(2);
  });

  it("staff may record damage but not opening stock or general adjustments", async () => {
    const owner = await newMerchant();
    const staff = await newMerchant();
    await call(addMember, { cookie: owner.cookie, params: { storeId: owner.storeId }, body: { email: staff.email, role: "staff" } });
    const p = await mk(owner, { name: "Candy", openingQuantity: 10 });
    const post = (type: string) => call(adjust, { cookie: staff.cookie, params: { storeId: owner.storeId }, body: { productId: p.id, type, direction: "increase", quantity: 1, reason: "test reason", idempotencyKey: key() } });
    expect((await post("damaged")).status).toBe(201);
    expect((await post("opening")).status).toBe(403);
    expect((await post("adjustment")).status).toBe(403);
  });

  it("cannot move stock of another store's product", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const p = await mk(a, { name: "Soap", openingQuantity: 5 });
    const r = await call(adjust, { cookie: b.cookie, params: { storeId: b.storeId }, body: { productId: p.id, type: "damaged", quantity: 1, reason: "steal", idempotencyKey: key() } });
    expect(r.status).toBe(404);
    expect(await qty(a, p.id)).toBe(5);
  });

  it("serialises concurrent decrements: never oversells, balance matches ledger", async () => {
    const m = await newMerchant();
    const p = await mk(m, { name: "Last 10 Yakult", openingQuantity: 10 });
    const ctx = await requireStoreAccess(m.userId, m.storeId);
    const attempts = await Promise.allSettled(
      Array.from({ length: 25 }, () => getDb().transaction((tx) => applyMovement(tx, ctx, { productId: p.id, type: "sale", delta: -1 }))),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled").length;
    expect(ok).toBe(10);
    expect(attempts.filter((a) => a.status === "rejected").every((a) => (a as PromiseRejectedResult).reason.code === "INSUFFICIENT_STOCK")).toBe(true);
    expect(await qty(m, p.id)).toBe(0);
    expect(await ledgerSum(p.id)).toBe(0);
    const { rows } = await getPool().query("select balance_after from inventory_transactions where product_id=$1 and type='sale' order by created_at", [p.id]);
    expect(new Set(rows.map((r) => r.balance_after)).size).toBe(10); // each sale saw a distinct balance
  });

  it("concurrent retries of the same adjustment apply once", async () => {
    const m = await newMerchant();
    const p = await mk(m, { name: "Load card", openingQuantity: 10 });
    const body = { productId: p.id, type: "damaged", quantity: 1, reason: "Duplicate tap", idempotencyKey: key() };
    const rs = await Promise.all(Array.from({ length: 5 }, () => call(adjust, { cookie: m.cookie, params: { storeId: m.storeId }, body })));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(await qty(m, p.id)).toBe(9);
  });

  it("physical count records only the differences", async () => {
    const m = await newMerchant();
    const a = await mk(m, { name: "A", openingQuantity: 10 });
    const b = await mk(m, { name: "B", openingQuantity: 5 });
    const r = await call(count, { cookie: m.cookie, params: { storeId: m.storeId }, body: { idempotencyKey: key(), lines: [{ productId: a.id, countedQuantity: 8 }, { productId: b.id, countedQuantity: 5 }] } });
    expect(r.status).toBe(201);
    expect(r.json.data.corrections).toHaveLength(1);
    expect(r.json.data.corrections[0].quantityDelta).toBe("-2.000");
    expect(r.json.data.unchanged).toEqual([b.id]);
    expect(await qty(m, a.id)).toBe(8);
  });

  it("packaging variants keep separate stock; opening a box moves units explicitly", async () => {
    const m = await newMerchant();
    const sachet = await mk(m, { name: "Nescafe Classic sachet", unit: "sachet", openingQuantity: 3 });
    const box = await mk(m, { name: "Nescafe Classic box (48)", unit: "box", packChildId: sachet.id, packQuantity: 48, openingQuantity: 2 });
    expect(await qty(m, sachet.id)).toBe(3); // the box's stock did not leak into sachets
    const r = await call(repack, { cookie: m.cookie, params: { storeId: m.storeId }, body: { packProductId: box.id, packs: 1, idempotencyKey: key() } });
    expect(r.status).toBe(201);
    expect(await qty(m, box.id)).toBe(1);
    expect(await qty(m, sachet.id)).toBe(51);
    const notPack = await call(repack, { cookie: m.cookie, params: { storeId: m.storeId }, body: { packProductId: sachet.id, packs: 1, idempotencyKey: key() } });
    expect(notPack.status).toBe(422);
  });
});
