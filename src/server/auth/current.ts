import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE, STORE_COOKIE } from "./session";
import { listMyStores, requireStoreAccess } from "@/server/services/stores";
import { AppError } from "@/server/errors";

/** Server Components: current user or null. Cached per request. */
export const getCurrentUser = cache(async () => {
  // Auth checks compare against the current time; always evaluate them per request.
  await connection();
  const jar = await cookies();
  return getSessionUser(jar.get(SESSION_COOKIE)?.value);
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For pages inside the merchant app: a logged-in user plus a store they belong to.
 * Falls back to their first store if the cookie is missing or stale.
 */
export const requireAppContext = cache(async () => {
  const user = await requireUser();
  const stores = await listMyStores(user.id);
  if (stores.length === 0) redirect("/onboarding");
  const jar = await cookies();
  const wanted = jar.get(STORE_COOKIE)?.value;
  const active = stores.find((s) => s.id === wanted) ?? stores[0];
  try {
    const store = await requireStoreAccess(user.id, active.id);
    return { user, stores, active, store };
  } catch (e) {
    if (e instanceof AppError) redirect("/onboarding");
    throw e;
  }
});

/** KELSON Super-Admin pages: platform admins only; everyone else gets a 404. */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  return user;
}
