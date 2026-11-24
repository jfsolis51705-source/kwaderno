import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { AppError } from "@/server/errors";
import { dummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { writeAudit } from "@/server/audit";
import { loginSchema, registerSchema } from "@/lib/validation";

export async function registerUser(input: unknown, ip?: string | null) {
  const data = registerSchema.parse(input);
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, data.email)).limit(1);
  if (existing.length) throw new AppError("CONFLICT", "An account with this email already exists", { field: "email" });
  const passwordHash = await hashPassword(data.password);
  return db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: data.email, fullName: data.fullName, phone: data.phone ?? null, passwordHash })
      .returning({ id: users.id, email: users.email, fullName: users.fullName });
    await writeAudit(tx, { userId: u.id, action: "user.register", entityType: "user", entityId: u.id, after: { email: u.email }, ip });
    return u;
  });
}

/** Returns the user on success. Uses the same error and similar timing for unknown email vs wrong password. */
export async function authenticate(input: unknown) {
  const data = loginSchema.parse(input);
  const [u] = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${data.email} and ${users.deletedAt} is null`)
    .limit(1);
  const ok = await verifyPassword(u?.passwordHash ?? (await dummyHash()), data.password);
  if (!u || !ok) throw new AppError("UNAUTHENTICATED", "Incorrect email or password");
  return { id: u.id, email: u.email, fullName: u.fullName, isPlatformAdmin: u.isPlatformAdmin };
}
