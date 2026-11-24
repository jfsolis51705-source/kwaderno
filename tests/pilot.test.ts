import { describe, expect, it } from "vitest";
import { POST as createStore } from "@/app/api/v1/stores/route";
import { GET as getStore, PATCH as patchStore } from "@/app/api/v1/stores/[storeId]/route";
import { GET as adminPilots } from "@/app/api/v1/admin/pilot-merchants/route";
import { getPool } from "@/db";
import { importPilotMerchants } from "@/server/services/pilot";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

// Synthetic pins (fictional stores) — real pilot data never goes into tests.
const PIN_A = { externalKey: "test-pin-a", layer: "TEST", storeName: "Tindahan ni Test A", ownerName: "Juan Test", contactPhone: "09170000001", latitude: 14.6632, longitude: 121.0403, signed: true };
const PIN_B = { externalKey: "test-pin-b", layer: "TEST", storeName: "Tindahan ni Test B", latitude: 14.7, longitude: 121.1 };

describe("store location and pilot matching", () => {
  it("imports pilot pins idempotently", async () => {
    expect(await importPilotMerchants([PIN_A, PIN_B])).toEqual({ inserted: 2, updated: 0, total: 2 });
    expect(await importPilotMerchants([{ ...PIN_A, storeName: "Renamed A" }])).toEqual({ inserted: 0, updated: 1, total: 1 });
    const { rows } = await getPool().query("select count(*)::int n from pilot_merchants");
    expect(rows[0].n).toBe(2);
  });

  it("rejects payment-like or malformed pilot rows", async () => {
    await expect(importPilotMerchants([{ ...PIN_A, contactPhone: "0x1f2983ce671b93e8" }])).rejects.toThrow();
    await expect(importPilotMerchants([{ ...PIN_A, latitude: 200 }])).rejects.toThrow();
  });

  it("matches a new store within 50 m and exposes only the pilot store name", async () => {
    await importPilotMerchants([PIN_A, PIN_B]);
    const m = await newMerchant();
    // ~20 m from PIN_A
    const r = await call(createStore, { cookie: m.cookie, body: { name: "My store", latitude: 14.66338, longitude: 121.0404 } });
    expect(r.status).toBe(201);
    expect(r.json.data.pilotMatch).toBe("Tindahan ni Test A");
    const g = await call(getStore, { cookie: m.cookie, params: { storeId: r.json.data.id } });
    expect(g.json.data.pilotStoreName).toBe("Tindahan ni Test A");
    expect(JSON.stringify(g.json.data)).not.toContain("Juan Test");
    expect(JSON.stringify(g.json.data)).not.toContain("09170000001");
  });

  it("does not match beyond 50 m, and a pin can be claimed by only one store", async () => {
    await importPilotMerchants([PIN_A]);
    const m = await newMerchant();
    const far = await call(createStore, { cookie: m.cookie, body: { name: "Far", latitude: 14.6642, longitude: 121.0403 } }); // ~110 m
    expect(far.json.data.pilotMatch).toBeNull();
    const first = await call(createStore, { cookie: m.cookie, body: { name: "First", latitude: 14.6632, longitude: 121.0403 } });
    const second = await call(createStore, { cookie: m.cookie, body: { name: "Second", latitude: 14.6632, longitude: 121.0403 } });
    expect(first.json.data.pilotMatch).toBe("Tindahan ni Test A");
    expect(second.json.data.pilotMatch).toBeNull();
  });

  it("matches when a location is added later in settings, and validates coordinates", async () => {
    await importPilotMerchants([PIN_B]);
    const m = await newMerchant();
    const bad = await call(patchStore, { method: "PATCH", cookie: m.cookie, params: { storeId: m.storeId }, body: { latitude: 14.7 } });
    expect(bad.status).toBe(422);
    const out = await call(patchStore, { method: "PATCH", cookie: m.cookie, params: { storeId: m.storeId }, body: { latitude: 95, longitude: 121 } });
    expect(out.status).toBe(422);
    const ok = await call(patchStore, { method: "PATCH", cookie: m.cookie, params: { storeId: m.storeId }, body: { latitude: 14.70001, longitude: 121.10001 } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.pilotMatch).toBe("Tindahan ni Test B");
    expect(ok.json.data.latitude).toBe("14.700010");
    const clear = await call(patchStore, { method: "PATCH", cookie: m.cookie, params: { storeId: m.storeId }, body: { latitude: null, longitude: null } });
    expect(clear.json.data.latitude).toBeNull();
  });

  it("pilot list is visible only to platform admins", async () => {
    await importPilotMerchants([PIN_A]);
    const m = await newMerchant();
    expect((await call(adminPilots, { cookie: m.cookie })).status).toBe(403);
    expect((await call(adminPilots, {})).status).toBe(401);
    await getPool().query("update users set is_platform_admin = true where id = $1", [m.userId]);
    const r = await call(adminPilots, { cookie: m.cookie });
    expect(r.status).toBe(200);
    expect(r.json.data[0]).toMatchObject({ store_name: "Tindahan ni Test A", owner_name: "Juan Test" });
  });
});
