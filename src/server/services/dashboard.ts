import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { StoreContext } from "./stores";

export interface DashboardRange {
  /** inclusive YYYY-MM-DD in store timezone */
  from: string;
  /** inclusive YYYY-MM-DD in store timezone */
  to: string;
}

/** Today's date (YYYY-MM-DD) in the store's timezone. */
export async function storeToday(ctx: StoreContext): Promise<string> {
  const r = await getDb().execute<{ d: string }>(
    sql`select to_char(now() at time zone s.timezone, 'YYYY-MM-DD') as d from stores s where s.id = ${ctx.storeId}`,
  );
  return r.rows[0].d;
}

/**
 * All dashboard figures are computed from the ledger tables at request time.
 * Nothing here is cached or hard-coded.
 */
export async function getDashboard(ctx: StoreContext, range: DashboardRange) {
  const db = getDb();
  const s = ctx.storeId;
  // Range bounds converted from store-local dates to timestamptz.
  const bounds = sql`(select (${range.from}::date)::timestamp at time zone timezone as lo, ((${range.to}::date + 1))::timestamp at time zone timezone as hi from stores where id = ${s})`;

  const [salesAgg, catalog, utang, lowStock, recentSales, recentMoves] = await Promise.all([
    db.execute<{ total: string; count: string; cash: string; gcash: string; credit: string }>(sql`
      select coalesce(sum(total_centavos),0) total, count(*) count,
        coalesce(sum(total_centavos) filter (where payment_method='cash'),0) cash,
        coalesce(sum(total_centavos) filter (where payment_method='gcash'),0) gcash,
        coalesce(sum(total_centavos) filter (where payment_method='credit'),0) credit
      from sales, ${bounds} b
      where store_id = ${s} and status = 'completed' and occurred_at >= b.lo and occurred_at < b.hi`),
    db.execute<{ products: string; value: string }>(sql`
      select count(*) products,
        coalesce(sum(greatest(coalesce(ib.quantity,0),0) * p.purchase_cost_centavos),0)::bigint value
      from products p left join inventory_balances ib on ib.product_id = p.id
      where p.store_id = ${s} and p.archived_at is null`),
    db.execute<{ outstanding: string; debtors: string }>(sql`
      select coalesce(sum(balance_centavos) filter (where balance_centavos > 0),0) outstanding,
        count(*) filter (where balance_centavos > 0) debtors
      from customers where store_id = ${s} and deleted_at is null`),
    db.execute<{ id: string; name: string; unit: string; quantity: string; reorder_threshold: string }>(sql`
      select p.id, p.name, p.unit, coalesce(ib.quantity,0)::text quantity, p.reorder_threshold::text
      from products p left join inventory_balances ib on ib.product_id = p.id
      where p.store_id = ${s} and p.archived_at is null and p.is_active
        and coalesce(ib.quantity,0) <= p.reorder_threshold
      order by coalesce(ib.quantity,0) - p.reorder_threshold asc, p.name
      limit 8`),
    db.execute<{ id: string; sale_no: number; total_centavos: string; payment_method: string; occurred_at: Date; items: string; customer: string | null }>(sql`
      select sa.id, sa.sale_no, sa.total_centavos, sa.payment_method, sa.occurred_at,
        (select count(*) from sale_items si where si.sale_id = sa.id) items, c.name customer
      from sales sa left join customers c on c.id = sa.customer_id
      where sa.store_id = ${s} and sa.status = 'completed'
      order by sa.occurred_at desc limit 6`),
    db.execute<{ id: string; type: string; quantity_delta: string; created_at: Date; product: string; unit: string; by: string | null }>(sql`
      select t.id, t.type, t.quantity_delta::text, t.created_at, p.name product, p.unit, u.full_name by
      from inventory_transactions t join products p on p.id = t.product_id left join users u on u.id = t.created_by
      where t.store_id = ${s} order by t.created_at desc limit 6`),
  ]);

  const a = salesAgg.rows[0];
  const lowCount = await db.execute<{ n: string }>(sql`
    select count(*) n from products p left join inventory_balances ib on ib.product_id = p.id
    where p.store_id = ${s} and p.archived_at is null and p.is_active and coalesce(ib.quantity,0) <= p.reorder_threshold`);

  return {
    range,
    sales: {
      totalCentavos: Number(a.total),
      count: Number(a.count),
      byMethod: { cash: Number(a.cash), gcash: Number(a.gcash), credit: Number(a.credit) },
    },
    productCount: Number(catalog.rows[0].products),
    inventoryValueCentavos: Number(catalog.rows[0].value),
    utang: { outstandingCentavos: Number(utang.rows[0].outstanding), customers: Number(utang.rows[0].debtors) },
    lowStock: { count: Number(lowCount.rows[0].n), items: lowStock.rows },
    recentSales: recentSales.rows.map((r) => ({ ...r, total_centavos: Number(r.total_centavos), items: Number(r.items) })),
    recentMovements: recentMoves.rows,
  };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
