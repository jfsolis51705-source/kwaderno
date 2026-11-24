import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { forbidden } from "@/server/errors";
import { hasRole, type StoreContext } from "./stores";

const q = z.object({
  action: z.string().trim().max(40).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Store audit trail (who did what, with before/after). Owners and managers only. */
export async function listAudit(ctx: StoreContext, query: unknown) {
  if (!hasRole(ctx, "manager")) throw forbidden("Only owners and managers can view the audit log");
  const p = q.parse(query);
  const tz = sql`(select timezone from stores where id = ${ctx.storeId})`;
  const where = [sql`a.store_id = ${ctx.storeId}`];
  if (p.action) where.push(sql`a.action like ${p.action.replace(/[%_\\]/g, "") + "%"}`);
  if (p.from) where.push(sql`a.created_at >= (${p.from}::date)::timestamp at time zone ${tz}`);
  if (p.to) where.push(sql`a.created_at < ((${p.to}::date + 1))::timestamp at time zone ${tz}`);
  const r = await getDb().execute<{ id: string; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; created_at: Date; user_name: string | null; ip: string | null }>(sql`
    select a.id, a.action, a.entity_type, a.entity_id, a.before, a.after, a.created_at, a.ip, u.full_name user_name
    from audit_logs a left join users u on u.id = a.user_id
    where ${sql.join(where, sql` and `)} order by a.created_at desc limit ${p.limit} offset ${p.offset}`);
  return r.rows;
}
