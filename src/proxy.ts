import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects visitors without a session cookie away from app
 * pages. Real authentication + store authorization happen server-side on every
 * page (requireAppContext) and API route (storeRoute).
 */
const PUBLIC = ["/login", "/register", "/offline"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("kw_session");
  if (pathname === "/") return NextResponse.redirect(new URL(hasSession ? "/dashboard" : "/login", req.url));
  if (!hasSession && !PUBLIC.includes(pathname)) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API (it returns 401 JSON itself), Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|manifest.webmanifest|sw.js|offline|icon|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
