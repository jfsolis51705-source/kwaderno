import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assertPlatformAdmin } from "./pilot";

/**
 * KELSON system-owner (Super-Admin) views across ALL stores. Every function checks
 * users.is_platform_admin first. Figures are computed live from the store ledgers.
 * Days are Asia/Manila (the pilot region).
 */
const TZ = sql`'Asia/Manila'`;
const dayStart = (daysAgo: number) => sql`((now() at time zone ${TZ})::date - ${daysAgo}::int)::timestamp at time zone ${TZ}`;

export async function getPlatformOverview(userId: string) {
  await assertPlatformAdmin(userId);
  const db = getDb();
  const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows[0];
  const [totals, sales, trend, byType, byCity, topStores, pilot] = await Promise.all([
    one<{ stores: string; active7: string; users: string; products: string; utang: string; inventory: string; receipts: string; offline_ops: string }>(sql`
      select (select count(*) from stores where deleted_at is null) stores,
        (select count(distinct store_id) from sales where status = 'completed' and occurred_at >= ${dayStart(6)}) active7,
        (select count(*) from users where deleted_at is null) users,
        (select count(*) from products where archived_at is null) products,
        (select coalesce(sum(balance_centavos) filter (where balance_centavos > 0), 0) from customers where deleted_at is null) utang,
        (select coalesce(sum(round(greatest(b.quantity, 0) * p.purchase_cost_centavos)), 0) from products p join inventory_balances b on b.product_id = p.id where p.archived_at is null) inventory,
        (select count(*) from receipts where status = 'confirmed') receipts,
        (select count(*) from sync_operations where status = 'applied') offline_ops`),
    one<{ today: string; today_n: string; d7: string; d7_n: string; d30: string; d30_n: string; credit30: string; gcash30: string }>(sql`
      select coalesce(sum(total_centavos) filter (where occurred_at >= ${dayStart(0)}), 0) today,
        count(*) filter (where occurred_at >= ${dayStart(0)}) today_n,
        coalesce(sum(total_centavos) filter (where occurred_at >= ${dayStart(6)}), 0) d7,
        count(*) filter (where occurred_at >= ${dayStart(6)}) d7_n,
        coalesce(sum(total_centavos), 0) d30, count(*) d30_n,
        coalesce(sum(total_centavos) filter (where payment_method = 'credit'), 0) credit30,
        coalesce(sum(total_centavos) filter (where payment_method = 'gcash'), 0) gcash30
      from sales where status = 'completed' and occurred_at >= ${dayStart(29)}`),
    db.execute<{ day: string; total: string; n: string }>(sql`
      select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(s.total_centavos), 0) as total, count(s.id) as n
      from generate_series((now() at time zone ${TZ})::date - 29, (now() at time zone ${TZ})::date, interval '1 day') d
      left join sales s on s.status = 'completed' and (s.occurred_at at time zone ${TZ})::date = d::date
      group by d order by d`),
    db.execute<{ business_type: string; n: string }>(sql`select business_type, count(*) n from stores where deleted_at is null group by 1 order by 2 desc`),
    db.execute<{ city: string; stores: string; sales30: string }>(sql`
      select coalesce(nullif(trim(st.city), ''), 'Not set') city, count(distinct st.id) stores,
        coalesce(sum(sa.total_centavos) filter (where sa.status = 'completed' and sa.occurred_at >= ${dayStart(29)}), 0) sales30
      from stores st left join sales sa on sa.store_id = st.id where st.deleted_at is null group by 1 order by sales30 desc, stores desc limit 12`),
    db.execute<{ id: string; name: string; city: string | null; sales30: string; n30: string }>(sql`
      select st.id, st.name, st.city, coalesce(sum(sa.total_centavos), 0) sales30, count(sa.id) n30
      from stores st left join sales sa on sa.store_id = st.id and sa.status = 'completed' and sa.occurred_at >= ${dayStart(29)}
      where st.deleted_at is null group by st.id order by sales30 desc limit 10`),
    one<{ pins: string; claimed: string; signed: string; retained: string }>(sql`
      select count(*) pins, count(*) filter (where exists (select 1 from stores s where s.pilot_merchant_id = p.id)) claimed,
        count(*) filter (where signed) signed, count(*) filter (where retention_status = 'retain') retained
      from pilot_merchants p`),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    totals: { stores: n(totals.stores), activeStores7d: n(totals.active7), users: n(totals.users), products: n(totals.products), utangCentavos: n(totals.utang), inventoryValueCentavos: n(totals.inventory), receiptsConfirmed: n(totals.receipts), offlineOpsSynced: n(totals.offline_ops) },
    sales: { todayCentavos: n(sales.today), todayCount: n(sales.today_n), d7Centavos: n(sales.d7), d7Count: n(sales.d7_n), d30Centavos: n(sales.d30), d30Count: n(sales.d30_n), credit30Centavos: n(sales.credit30), gcash30Centavos: n(sales.gcash30) },
    trend: trend.rows.map((r) => ({ day: r.day, totalCentavos: n(r.total), count: n(r.n) })),
    byType: byType.rows.map((r) => ({ type: r.business_type, stores: n(r.n) })),
    byCity: byCity.rows.map((r) => ({ city: r.city, stores: n(r.stores), sales30Centavos: n(r.sales30) })),
    topStores: topStores.rows.map((r) => ({ id: r.id, name: r.name, city: r.city, sales30Centavos: n(r.sales30), sales30Count: n(r.n30) })),
    pilot: { pins: n(pilot.pins), claimed: n(pilot.claimed), signed: n(pilot.signed), retained: n(pilot.retained) },
  };
}
export type PlatformOverview = Awaited<ReturnType<typeof getPlatformOverview>>;

export async function listPlatformStores(userId: string) {
  await assertPlatformAdmin(userId);
  const r = await getDb().execute<{
    id: string; name: string; business_type: string; city: string | null; barangay: string | null; created_at: Date; owner: string | null;
    members: string; products: string; customers: string; sales30: string; last_sale: Date | null; latitude: string | null; longitude: string | null; pilot_store: string | null;
  }>(sql`
    select st.id, st.name, st.business_type, st.city, st.barangay, st.created_at, st.latitude, st.longitude, pm.store_name pilot_store,
      (select u.full_name from store_members m join users u on u.id = m.user_id where m.store_id = st.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1) owner,
      (select count(*) from store_members m where m.store_id = st.id and m.status = 'active') members,
      (select count(*) from products p where p.store_id = st.id and p.archived_at is null) products,
      (select count(*) from customers c where c.store_id = st.id and c.deleted_at is null) customers,
      (select coalesce(sum(total_centavos), 0) from sales s where s.store_id = st.id and s.status = 'completed' and s.occurred_at >= now() - interval '30 days') sales30,
      (select max(occurred_at) from sales s where s.store_id = st.id) last_sale
    from stores st left join pilot_merchants pm on pm.id = st.pilot_merchant_id
    where st.deleted_at is null order by st.created_at desc`);
  return r.rows.map((s) => ({
    ...s,
    members: Number(s.members), products: Number(s.products), customers: Number(s.customers), sales30Centavos: Number(s.sales30),
    latitude: s.latitude == null ? null : Number(s.latitude), longitude: s.longitude == null ? null : Number(s.longitude),
  }));
}

/** Points for the network map: every pilot pin (claimed or not) and every app store with GPS. */
export async function getNetworkMap(userId: string) {
  await assertPlatformAdmin(userId);
  const db = getDb();
  const [pins, stores] = await Promise.all([
    db.execute<{ id: string; store_name: string; layer: string; barangay: string | null; city: string | null; latitude: string; longitude: string; signed: boolean; retention_status: string | null; app_store_id: string | null; app_store_name: string | null }>(sql`
      select p.id, p.store_name, p.layer, p.barangay, p.city, p.latitude, p.longitude, p.signed, p.retention_status, s.id app_store_id, s.name app_store_name
      from pilot_merchants p left join stores s on s.pilot_merchant_id = p.id and s.deleted_at is null`),
    db.execute<{ id: string; name: string; city: string | null; latitude: string; longitude: string }>(sql`
      select id, name, city, latitude, longitude from stores where deleted_at is null and latitude is not null and pilot_merchant_id is null`),
  ]);
  return {
    pins: pins.rows.map((p) => ({ ...p, latitude: Number(p.latitude), longitude: Number(p.longitude) })),
    unpinnedStores: stores.rows.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude) })),
  };
}
export type NetworkMap = Awaited<ReturnType<typeof getNetworkMap>>;
