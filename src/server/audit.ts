import type { Executor } from "@/db";
import { auditLogs } from "@/db/schema";

export interface AuditEntry {
  storeId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append-only audit trail. Call inside the same transaction as the change it describes. */
export async function writeAudit(db: Executor, e: AuditEntry) {
  await db.insert(auditLogs).values({
    storeId: e.storeId ?? null,
    userId: e.userId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: (e.before ?? null) as object | null,
    after: (e.after ?? null) as object | null,
    ip: e.ip ?? null,
  });
}
