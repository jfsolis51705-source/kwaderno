import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { pilotMerchants, storeMembers, stores, users } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/server/errors";
import { writeAudit } from "@/server/audit";
import { matchStoreToPilot } from "./pilot";
import { addMemberSchema, storeSchema, storeUpdateSchema, updateMemberSchema, type Role } from "@/lib/validation";

export interface StoreContext {
  userId: string;
  storeId: string;
  role: Role;
  ip?: string | null;
}

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

/**
 * The single gate for store-scoped access. Every store-scoped service call starts
 * from a StoreContext produced here, which guarantees the user is an active member.
 */
export async function requireStoreAccess(userId: string, storeId: string, minRole: Role = "staff"): Promise<StoreContext> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw notFound("Store");
  const [m] = await getDb()
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId), eq(storeMembers.status, "active"), isNull(stores.deletedAt)))
    .limit(1);
  // Same response for "doesn't exist" and "not yours" so store IDs can't be probed.
  if (!m) throw notFound("Store");
  if (RANK[m.role] < RANK[minRole]) throw forbidden(`This action needs the ${minRole} role`);
  return { userId, storeId, role: m.role };
}

export function hasRole(ctx: StoreContext, min: Role) {
  return RANK[ctx.role] >= RANK[min];
}

export async function listMyStores(userId: string) {
  return getDb()
    .select({ id: stores.id, name: stores.name, businessType: stores.businessType, role: storeMembers.role, city: stores.city })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.userId, userId), eq(storeMembers.status, "active"), isNull(stores.deletedAt)))
    .orderBy(asc(stores.createdAt));
}

export async function createStore(userId: string, input: unknown, ip?: string | null) {
  const data = storeSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const { latitude, longitude, ...rest } = data;
    const [s] = await tx
      .insert(stores)
      .values({ ...rest, phone: data.phone ?? null, createdBy: userId, ...geo(latitude, longitude) })
      .returning();
    await tx.insert(storeMembers).values({ storeId: s.id, userId, role: "owner" });
    const pilotMatch = latitude != null && longitude != null ? await matchStoreToPilot(tx, s.id, latitude, longitude) : null;
    await writeAudit(tx, { storeId: s.id, userId, action: "store.create", entityType: "store", entityId: s.id, after: { ...s, pilotMatch }, ip });
    return { ...s, pilotMatch };
  });
}

const geo = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat == null || lng == null ? { latitude: null, longitude: null } : { latitude: lat.toFixed(6), longitude: lng.toFixed(6) };

export async function getStore(ctx: StoreContext) {
  const [s] = await getDb().select().from(stores).where(eq(stores.id, ctx.storeId)).limit(1);
  if (!s) throw notFound("Store");
  // Only the surveyed store NAME is exposed to merchants — never the pilot owner/contact data.
  const [pilot] = s.pilotMerchantId
    ? await getDb().select({ storeName: pilotMerchants.storeName }).from(pilotMerchants).where(eq(pilotMerchants.id, s.pilotMerchantId))
    : [];
  return { ...s, pilotStoreName: pilot?.storeName ?? null };
}

export async function updateStore(ctx: StoreContext, input: unknown) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can edit the store profile");
  const data = storeUpdateSchema.parse(input);
  if (data.allowNegativeStock !== undefined && !hasRole(ctx, "owner")) throw forbidden("Only the owner can change stock rules");
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(stores).where(eq(stores.id, ctx.storeId)).for("update");
    const { latitude, longitude, ...rest } = data;
    const locationChanged = latitude !== undefined;
    let [after] = await tx
      .update(stores)
      .set({ ...rest, ...(locationChanged ? geo(latitude, longitude) : {}) })
      .where(eq(stores.id, ctx.storeId))
      .returning();
    let pilotMatch: string | null = null;
    if (locationChanged && latitude != null && longitude != null && !before.pilotMerchantId) {
      pilotMatch = await matchStoreToPilot(tx, ctx.storeId, latitude, longitude);
      if (pilotMatch) [after] = await tx.select().from(stores).where(eq(stores.id, ctx.storeId));
    }
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "store.update", entityType: "store", entityId: ctx.storeId, before, after, ip: ctx.ip });
    return { ...after, pilotMatch };
  });
}

export async function listMembers(ctx: StoreContext) {
  return getDb()
    .select({ id: storeMembers.id, userId: users.id, fullName: users.fullName, email: users.email, role: storeMembers.role, status: storeMembers.status, createdAt: storeMembers.createdAt })
    .from(storeMembers)
    .innerJoin(users, eq(users.id, storeMembers.userId))
    .where(and(eq(storeMembers.storeId, ctx.storeId), eq(storeMembers.status, "active")))
    .orderBy(asc(storeMembers.createdAt));
}

/** Adds an existing KWADERNO user to the store. (Email invitations come later.) */
export async function addMember(ctx: StoreContext, input: unknown) {
  if (!hasRole(ctx, "owner")) throw forbidden("Only the owner can add staff");
  const data = addMemberSchema.parse(input);
  const db = getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email} and ${users.deletedAt} is null`).limit(1);
  if (!u) throw new AppError("NOT_FOUND", "No KWADERNO account uses that email. Ask them to register first.", { field: "email" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(storeMembers)
      .values({ storeId: ctx.storeId, userId: u.id, role: data.role, status: "active" })
      .onConflictDoUpdate({
        target: [storeMembers.storeId, storeMembers.userId],
        set: { role: data.role, status: "active" },
        setWhere: sql`${storeMembers.status} <> 'active'`,
      })
      .returning();
    if (!row) throw new AppError("CONFLICT", "That person is already a member of this store");
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "member.add", entityType: "store_member", entityId: row.id, after: row, ip: ctx.ip });
    return row;
  });
}

export async function updateMember(ctx: StoreContext, memberId: string, input: unknown) {
  if (!hasRole(ctx, "owner")) throw forbidden("Only the owner can change roles");
  const data = updateMemberSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(storeMembers).where(and(eq(storeMembers.id, memberId), eq(storeMembers.storeId, ctx.storeId))).for("update");
    if (!before || before.status !== "active") throw notFound("Member");
    if (before.role === "owner" && data.role !== "owner") await assertAnotherOwner(tx, ctx.storeId, before.id);
    const [after] = await tx.update(storeMembers).set({ role: data.role }).where(eq(storeMembers.id, memberId)).returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "member.role", entityType: "store_member", entityId: memberId, before, after, ip: ctx.ip });
    return after;
  });
}

export async function removeMember(ctx: StoreContext, memberId: string) {
  if (!hasRole(ctx, "owner")) throw forbidden("Only the owner can remove staff");
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(storeMembers).where(and(eq(storeMembers.id, memberId), eq(storeMembers.storeId, ctx.storeId))).for("update");
    if (!before || before.status !== "active") throw notFound("Member");
    if (before.role === "owner") await assertAnotherOwner(tx, ctx.storeId, before.id);
    const [after] = await tx.update(storeMembers).set({ status: "removed" }).where(eq(storeMembers.id, memberId)).returning();
    await writeAudit(tx, { storeId: ctx.storeId, userId: ctx.userId, action: "member.remove", entityType: "store_member", entityId: memberId, before, after, ip: ctx.ip });
  });
}

async function assertAnotherOwner(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], storeId: string, exceptMemberId: string) {
  // Lock all owner rows so two concurrent demotions can't both pass this check.
  const owners = await tx
    .select({ id: storeMembers.id })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, "owner"), eq(storeMembers.status, "active")))
    .for("update");
  if (!owners.some((o) => o.id !== exceptMemberId)) throw new AppError("CONFLICT", "A store must keep at least one owner");
}
