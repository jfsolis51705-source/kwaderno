import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "@/db";
import { pilotMerchants, stores, users } from "@/db/schema";
import { forbidden } from "@/server/errors";

/** Max distance between a store's GPS fix and a surveyed pin to count as the same store. */
export const PILOT_MATCH_METERS = 50;

const haversine = (lat: unknown, lng: unknown) => sql`
  6371000 * 2 * asin(sqrt(
    power(sin(radians(p.latitude - ${lat}::numeric) / 2), 2) +
    cos(radians(${lat}::numeric)) * cos(radians(p.latitude)) * power(sin(radians(p.longitude - ${lng}::numeric) / 2), 2)
  ))`;

/**
 * Links a store to the nearest pilot merchant pin within PILOT_MATCH_METERS that no
 * other store has claimed. Safe under concurrency: the unique index on
 * stores.pilot_merchant_id makes a second claim fail, which we treat as "no match".
 * Returns the matched pilot store name (never owner/contact data) or null.
 */
export async function matchStoreToPilot(tx: Executor, storeId: string, lat: number, lng: number): Promise<string | null> {
  const r = await tx.execute<{ id: string; store_name: string; meters: number }>(sql`
    select p.id, p.store_name, ${haversine(lat, lng)} as meters
    from pilot_merchants p
    where p.latitude between ${lat - 0.001} and ${lat + 0.001}
      and p.longitude between ${lng - 0.001} and ${lng + 0.001}
      and not exists (select 1 from stores s where s.pilot_merchant_id = p.id and s.id <> ${storeId})
    order by meters asc limit 1`);
  const hit = r.rows[0];
  if (!hit || Number(hit.meters) > PILOT_MATCH_METERS) return null;
  try {
    await tx.execute(sql`savepoint pilot_match`);
    await tx.update(stores).set({ pilotMerchantId: hit.id }).where(eq(stores.id, storeId));
    await tx.execute(sql`release savepoint pilot_match`);
    return hit.store_name;
  } catch {
    await tx.execute(sql`rollback to savepoint pilot_match`);
    return null;
  }
}

export const pilotRowSchema = z.object({
  externalKey: z.string().min(6).max(64),
  layer: z.string().trim().min(1).max(80),
  surveyor: z.string().trim().max(120).nullish(),
  storeName: z.string().trim().min(1).max(200),
  businessType: z.string().trim().max(40).default("sari_sari"),
  ownerName: z.string().trim().max(160).nullish(),
  contactPhone: z.string().regex(/^09\d{9}$/).nullish(),
  address: z.string().trim().max(300).nullish(),
  barangay: z.string().trim().max(120).nullish(),
  city: z.string().trim().max(120).nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  signed: z.boolean().default(false),
  registration: z.string().trim().max(80).nullish(),
  retention: z.enum(["retain", "stopped"]).nullish(),
  surveyedOn: z.iso.date().nullish(),
});

/** Upserts normalised pilot rows (see scripts/pilot/normalize.py). Idempotent on externalKey. */
export async function importPilotMerchants(rows: unknown[]) {
  const parsed = z.array(pilotRowSchema).parse(rows);
  let inserted = 0;
  let updated = 0;
  await getDb().transaction(async (tx) => {
    for (const r of parsed) {
      const values = {
        externalKey: r.externalKey, layer: r.layer, surveyor: r.surveyor ?? null, storeName: r.storeName, businessType: r.businessType,
        ownerName: r.ownerName ?? null, contactPhone: r.contactPhone ?? null, address: r.address ?? null, barangay: r.barangay ?? null,
        city: r.city ?? null, latitude: r.latitude.toFixed(6), longitude: r.longitude.toFixed(6), signed: r.signed,
        registrationStatus: r.registration ?? null, retentionStatus: r.retention ?? null, surveyedOn: r.surveyedOn ?? null,
      };
      const res = await tx
        .insert(pilotMerchants)
        .values(values)
        .onConflictDoUpdate({ target: pilotMerchants.externalKey, set: { ...values, updatedAt: new Date() } })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (res[0].inserted) inserted++;
      else updated++;
    }
  });
  return { inserted, updated, total: parsed.length };
}

export async function assertPlatformAdmin(userId: string) {
  const [u] = await getDb().select({ admin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId));
  if (!u?.admin) throw forbidden("Only KELSON platform admins can view pilot merchants");
}

/** Platform admin view: every pilot pin with whether a KWADERNO store has claimed it. */
export async function listPilotMerchants(userId: string) {
  await assertPlatformAdmin(userId);
  const r = await getDb().execute(sql`
    select p.*, s.id as store_id, s.name as store_name_in_app
    from pilot_merchants p left join stores s on s.pilot_merchant_id = p.id
    order by p.layer, p.store_name`);
  return r.rows;
}
