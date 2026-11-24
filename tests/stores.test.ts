import { describe, expect, it } from "vitest";
import { GET as getStore, PATCH as patchStore } from "@/app/api/v1/stores/[storeId]/route";
import { GET as listStores } from "@/app/api/v1/stores/route";
import { GET as listMembers, POST as addMember } from "@/app/api/v1/stores/[storeId]/members/route";
import { PATCH as patchMember, DELETE as deleteMember } from "@/app/api/v1/stores/[storeId]/members/[memberId]/route";
import { getPool } from "@/db";
import { call } from "./helpers/api";
import { newMerchant } from "./helpers/factories";

describe("stores and membership", () => {
  it("creator becomes owner and the creation is audited", async () => {
    const a = await newMerchant({ storeName: "Nena's Store" });
    const r = await call(getStore, { cookie: a.cookie, params: { storeId: a.storeId } });
    expect(r.status).toBe(200);
    expect(r.json.data.myRole).toBe("owner");
    expect(r.json.data.timezone).toBe("Asia/Manila");
    const { rows } = await getPool().query("select action from audit_logs where store_id = $1", [a.storeId]);
    expect(rows.map((x) => x.action)).toContain("store.create");
  });

  it("isolates stores: another merchant gets 404 (not 403) for a foreign store", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const r = await call(getStore, { cookie: b.cookie, params: { storeId: a.storeId } });
    expect(r.status).toBe(404);
    const p = await call(patchStore, { method: "PATCH", cookie: b.cookie, params: { storeId: a.storeId }, body: { name: "Hacked" } });
    expect(p.status).toBe(404);
    const list = await call(listStores, { cookie: b.cookie });
    expect(list.json.data.map((s: { id: string }) => s.id)).toEqual([b.storeId]);
  });

  it("rejects unauthenticated access", async () => {
    const a = await newMerchant();
    const r = await call(getStore, { params: { storeId: a.storeId } });
    expect(r.status).toBe(401);
  });

  it("staff can read but not edit the store; owner can promote and remove", async () => {
    const owner = await newMerchant();
    const staff = await newMerchant();
    const add = await call(addMember, { cookie: owner.cookie, params: { storeId: owner.storeId }, body: { email: staff.email, role: "staff" } });
    expect(add.status).toBe(201);
    const memberId = add.json.data.id;

    expect((await call(getStore, { cookie: staff.cookie, params: { storeId: owner.storeId } })).status).toBe(200);
    const edit = await call(patchStore, { method: "PATCH", cookie: staff.cookie, params: { storeId: owner.storeId }, body: { name: "X" } });
    expect(edit.status).toBe(403);
    const staffAdds = await call(addMember, { cookie: staff.cookie, params: { storeId: owner.storeId }, body: { email: owner.email, role: "staff" } });
    expect(staffAdds.status).toBe(403);

    const promote = await call(patchMember, { method: "PATCH", cookie: owner.cookie, params: { storeId: owner.storeId, memberId }, body: { role: "manager" } });
    expect(promote.json.data.role).toBe("manager");
    const edit2 = await call(patchStore, { method: "PATCH", cookie: staff.cookie, params: { storeId: owner.storeId }, body: { city: "Quezon City" } });
    expect(edit2.status).toBe(200);
    // manager still can't change owner-only stock rules
    const rule = await call(patchStore, { method: "PATCH", cookie: staff.cookie, params: { storeId: owner.storeId }, body: { allowNegativeStock: true } });
    expect(rule.status).toBe(403);

    const del = await call(deleteMember, { method: "DELETE", cookie: owner.cookie, params: { storeId: owner.storeId, memberId } });
    expect(del.status).toBe(200);
    expect((await call(getStore, { cookie: staff.cookie, params: { storeId: owner.storeId } })).status).toBe(404);
  });

  it("refuses to remove or demote the last owner", async () => {
    const owner = await newMerchant();
    const members = await call(listMembers, { cookie: owner.cookie, params: { storeId: owner.storeId } });
    const memberId = members.json.data[0].id;
    const demote = await call(patchMember, { method: "PATCH", cookie: owner.cookie, params: { storeId: owner.storeId, memberId }, body: { role: "staff" } });
    expect(demote.status).toBe(409);
    const del = await call(deleteMember, { method: "DELETE", cookie: owner.cookie, params: { storeId: owner.storeId, memberId } });
    expect(del.status).toBe(409);
  });

  it("adding an unknown email gives a helpful 404", async () => {
    const owner = await newMerchant();
    const r = await call(addMember, { cookie: owner.cookie, params: { storeId: owner.storeId }, body: { email: "nobody@example.ph", role: "staff" } });
    expect(r.status).toBe(404);
    expect(r.json.error.message).toMatch(/register first/);
  });
});
