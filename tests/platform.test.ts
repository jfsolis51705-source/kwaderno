import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GET as overview } from "@/app/api/v1/admin/overview/route";
import { GET as stores } from "@/app/api/v1/admin/stores/route";
import { GET as map } from "@/app/api/v1/admin/map/route";
import { POST as createStore } from "@/app/api/v1/stores/route";
import { POST as createProduct } from "@/app/api/v1/stores/[storeId]/products/route";
import { POST as sell } from "@/app/api/v1/stores/[storeId]/sales/route";
import { getPool } from "@/db";
import { importPilotMerchants } from "@/server/services/pilot";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

async function sale(m: { cookie: string; storeId: string }, price: number, qty: number) {
  const p = (await call(createProduct, { cookie: m.cookie, params: { storeId: m.storeId }, body: { name: `P${randomUUID()}`, sellingPriceCentavos: price, openingQuantity: 100 } })).json.data.id;
  await call(sell, { cookie: m.cookie, params: { storeId: m.storeId }, body: { idempotencyKey: randomUUID(), paymentMethod: "cash", lines: [{ productId: p, quantity: qty }] } });
}

describe("Super-Admin platform views", () => {
  it("are forbidden for merchants and require login", async () => {
    const m = await newMerchant();
    for (const fn of [overview, stores, map]) {
      expect((await call(fn, { cookie: m.cookie })).status).toBe(403);
      expect((await call(fn, {})).status).toBe(401);
    }
  });

  it("aggregate live figures across all stores and track pilot conversion", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    await sale(a, 1000, 2);
    await sale(b, 500, 3);
    await importPilotMerchants([
      { externalKey: "test-pin-1", layer: "TEST", storeName: "Pin One", latitude: 14.6632, longitude: 121.0403, signed: true, retention: "retain" },
      { externalKey: "test-pin-2", layer: "TEST", storeName: "Pin Two", latitude: 14.7, longitude: 121.1 },
    ]);
    await call(createStore, { cookie: a.cookie, body: { name: "Joined via pin", latitude: 14.66321, longitude: 121.04031 } });
    const admin = await newMerchant();
    await getPool().query("update users set is_platform_admin = true where id = $1", [admin.userId]);

    const o = (await call(overview, { cookie: admin.cookie })).json.data;
    expect(o.sales).toMatchObject({ todayCentavos: 3500, todayCount: 2, d30Centavos: 3500 });
    expect(o.totals.stores).toBe(4);
    expect(o.totals.activeStores7d).toBe(2);
    expect(o.pilot).toEqual({ pins: 2, claimed: 1, signed: 1, retained: 1 });
    expect(o.trend).toHaveLength(30);
    expect(o.trend.at(-1).totalCentavos).toBe(3500);

    const list = (await call(stores, { cookie: admin.cookie })).json.data;
    expect(list.find((s: { name: string }) => s.name === "Joined via pin").pilot_store).toBe("Pin One");

    const m = (await call(map, { cookie: admin.cookie })).json.data;
    expect(m.pins.map((p: { store_name: string; app_store_name: string | null }) => [p.store_name, p.app_store_name]).sort()).toEqual([["Pin One", "Joined via pin"], ["Pin Two", null]]);
  });
});
