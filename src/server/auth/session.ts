import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "kw_session";
export const STORE_COOKIE = "kw_store";

export function ttlMs() {
  return Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs());
  await getDb()
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: meta.userAgent ?? null, ip: meta.ip ?? null });
  return { token, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt, id: users.id, email: users.email, fullName: users.fullName, isPlatformAdmin: users.isPlatformAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  // Sliding expiry, written at most once an hour to avoid a write per request.
  if (Date.now() - row.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ttlMs()) })
      .where(eq(sessions.id, row.sessionId));
  }
  return { sessionId: row.sessionId, id: row.id, email: row.email, fullName: row.fullName, isPlatformAdmin: row.isPlatformAdmin };
}

export async function deleteSession(token: string) {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}
