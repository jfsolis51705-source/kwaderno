import { NextResponse } from "next/server";
import { authRoute, ok, readJson } from "@/server/http";
import { createStore, listMyStores } from "@/server/services/stores";
import { cookieOptions, STORE_COOKIE } from "@/server/auth/session";

export const GET = authRoute(async (_req, { user }) => ok(await listMyStores(user.id)));

export const POST = authRoute(async (req, { user, ip }) => {
  const store = await createStore(user.id, await readJson(req), ip);
  const res = NextResponse.json({ data: store }, { status: 201 });
  res.cookies.set(STORE_COOKIE, store.id, cookieOptions(new Date(Date.now() + 365 * 864e5)));
  return res;
});
