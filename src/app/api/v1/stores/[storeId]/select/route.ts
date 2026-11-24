import { NextResponse } from "next/server";
import { storeRoute } from "@/server/http";
import { cookieOptions, STORE_COOKIE } from "@/server/auth/session";

/** Sets the active store for the web UI after verifying membership. */
export const POST = storeRoute(async (_req, { store }) => {
  const res = NextResponse.json({ data: { storeId: store.storeId, role: store.role } });
  res.cookies.set(STORE_COOKIE, store.storeId, cookieOptions(new Date(Date.now() + 365 * 864e5)));
  return res;
});
