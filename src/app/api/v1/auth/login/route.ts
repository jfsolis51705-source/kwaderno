import { NextResponse } from "next/server";
import { clientIp, publicRoute, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { authenticate } from "@/server/services/auth";
import { cookieOptions, createSession, SESSION_COOKIE } from "@/server/auth/session";
import { listMyStores } from "@/server/services/stores";
import { AppError } from "@/server/errors";
import { formBody, isFormPost, safeNext } from "@/server/form-post";

export const POST = publicRoute(async (req) => {
  const ip = clientIp(req);
  const html = isFormPost(req); // works before/without JavaScript: credentials are POSTed, never put in the URL
  const body = (html ? await formBody(req) : await readJson(req)) as { email?: unknown; next?: unknown };
  try {
    rateLimit(`login:ip:${ip}`, 30, 15 * 60 * 1000);
    rateLimit(`login:email:${String(body?.email ?? "").toLowerCase()}`, 8, 15 * 60 * 1000);
    const user = await authenticate(body);
    const { token, expiresAt } = await createSession(user.id, { userAgent: req.headers.get("user-agent"), ip });
    const stores = await listMyStores(user.id);
    const res = html
      ? NextResponse.redirect(new URL(stores.length ? safeNext(body.next, "/dashboard") : user.isPlatformAdmin ? "/admin" : "/onboarding", req.url), 303)
      : // `token` is returned only for non-browser clients that cannot use cookies (Bearer auth).
        NextResponse.json({ data: { user, stores, token: req.headers.get("x-client") === "native" ? token : undefined } });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
    return res;
  } catch (e) {
    if (html && e instanceof Error) {
      const url = new URL("/login", req.url);
      url.searchParams.set("error", e instanceof AppError && e.code === "RATE_LIMITED" ? "rate" : "invalid");
      return NextResponse.redirect(url, 303);
    }
    throw e;
  }
});
